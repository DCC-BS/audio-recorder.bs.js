import { acquireSessionLock, getLiveSessionIds } from "../utils/sessionLock";
import { type AudioSession, type AudioSessionStatus, db } from "./db";

export class AudioStorageService {
    // Generate unique ID
    private generateId(): string {
        // getRandomValues, unlike randomUUID, also exists outside secure
        // contexts (plain-http intranet hosts)
        const random = crypto.getRandomValues(new Uint32Array(2));
        return `${Date.now()}-${Array.from(random, (n) => n.toString(36)).join("")}`;
    }

    public async createSession(
        name: string,
        sampleRate: number,
        numChannels: number,
        source?: string,
    ): Promise<string> {
        const id = this.generateId();
        const now = new Date(Date.now()).toISOString();

        await db.audioSessions.add({
            id,
            name,
            createdAt: now,
            chunkCount: 0,
            totalSize: 0,
            chunkIds: [],
            sampleRate,
            numChannels,
            status: "recording",
            duration: 0,
            source,
        });

        return id;
    }

    /**
     * Appends an encoded chunk to a session.
     *
     * @param sessionId - The session to append to.
     * @param buffer - The encoded audio.
     * @param duration - Seconds of audio in the chunk.
     */
    public async storeAudioChunk(
        sessionId: string,
        buffer: ArrayBuffer,
        duration = 0,
    ): Promise<string> {
        const id = this.generateId();
        const now = new Date().toISOString();

        await db.transaction(
            "rw",
            db.audioChunks,
            db.audioSessions,
            async () => {
                // read inside the transaction: a status change may have
                // happened since the chunk was queued
                const session = await db.audioSessions.get(sessionId);
                if (!session) {
                    throw new Error(`Session with ID ${sessionId} not found`);
                }

                await db.audioChunks.add({
                    id,
                    sessionId,
                    createdAt: now,
                    buffer,
                });

                // Update session metadata
                session.chunkCount += 1;
                session.totalSize += buffer.byteLength;
                session.chunkIds.push(id);
                session.duration = (session.duration ?? 0) + duration;

                await db.audioSessions.put(session);
            },
        );

        return id;
    }

    public async getSession(
        sessionId: string,
    ): Promise<AudioSession | undefined> {
        return db.audioSessions.get(sessionId);
    }

    /**
     * Records where a session stands.
     *
     * @param sessionId - The session to update.
     * @param status - Its new status; `paused` also stamps `pausedAt`.
     */
    public async setSessionStatus(
        sessionId: string,
        status: AudioSessionStatus,
    ): Promise<void> {
        const changes: Partial<AudioSession> = { status };
        if (status === "paused") {
            changes.pausedAt = new Date().toISOString();
        }
        const updated = await db.audioSessions.update(sessionId, changes);
        if (updated === 0) {
            throw new Error(`Session with ID ${sessionId} not found`);
        }
    }

    /**
     * Lists the stored sessions no page is recording right now: paused,
     * interrupted and stopped ones. Newest first.
     */
    public async getResumableSessions(): Promise<AudioSession[]> {
        const [sessions, live] = await Promise.all([
            this.getAllSessions(),
            getLiveSessionIds(),
        ]);
        return sessions
            .filter((s) => !live.has(s.id))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    /**
     * The paused session waiting to be resumed, if any. Only one is
     * expected; should there be more, the most recently paused wins.
     */
    public async getPausedSession(): Promise<AudioSession | undefined> {
        const sessions = await this.getResumableSessions();
        return sessions
            .filter((s) => s.status === "paused")
            .sort((a, b) =>
                (b.pausedAt ?? b.createdAt).localeCompare(
                    a.pausedAt ?? a.createdAt,
                ),
            )[0];
    }

    public async getSessionChunks(sessionId: string): Promise<ArrayBuffer[]> {
        const chunks = await db.audioChunks
            .where("sessionId")
            .equals(sessionId)
            .toArray();

        return chunks.map((c) => c.buffer);
    }

    public async getAllSessions(): Promise<AudioSession[]> {
        const sessions = await db.audioSessions
            .where("chunkCount")
            .aboveOrEqual(1)
            .toArray();
        return sessions;
    }

    public async deleteSession(sessionId: string): Promise<void> {
        const session = await db.audioSessions.get(sessionId);
        if (!session) {
            throw new Error(`Session with ID ${sessionId} not found`);
        }

        await db.transaction(
            "rw",
            db.audioChunks,
            db.audioSessions,
            async () => {
                // Delete all associated chunks
                await db.audioChunks
                    .where("sessionId")
                    .equals(sessionId)
                    .delete();
                // Delete the session
                await db.audioSessions.delete(sessionId);
            },
        );
    }

    /**
     * Ends a stored session without deleting it, e.g. once a paused
     * recording was handed on: it is kept as a backup and can no longer be
     * continued.
     *
     * @param sessionId - The stored session.
     * @throws Error when a recorder owns the session right now (another tab
     *   resumed it), whose status must not be overwritten.
     */
    public async markAsStopped(sessionId: string): Promise<void> {
        const release = await acquireSessionLock(sessionId);
        if (!release) {
            throw new Error(
                `Session with ID ${sessionId} is being recorded elsewhere`,
            );
        }
        try {
            await this.setSessionStatus(sessionId, "stopped");
        } finally {
            release();
        }
    }

    /**
     * Deletes a session unless a recorder owns it; the lock is held until
     * the deletion is done, so no tab can resume it half way.
     *
     * @param sessionId - The session to delete.
     * @returns Whether it was deleted.
     */
    private async deleteUnownedSession(sessionId: string): Promise<boolean> {
        const release = await acquireSessionLock(sessionId);
        if (!release) {
            return false;
        }
        try {
            await this.deleteSession(sessionId);
            return true;
        } finally {
            release();
        }
    }

    public async clearSessionOverThreshold(maxSessions: number): Promise<void> {
        const live = await getLiveSessionIds();
        const sessions = (
            await db.audioSessions
                .where("chunkCount")
                .aboveOrEqual(1)
                .sortBy("createdAt")
        ).filter((s) => !live.has(s.id));

        if (sessions.length <= maxSessions) {
            return; // Nothing to delete
        }

        const sessionsToDelete = sessions.slice(
            0,
            sessions.length - maxSessions,
        );

        for (const session of sessionsToDelete) {
            await this.deleteUnownedSession(session.id);
        }
    }

    public async clearSessionsOlderThan(days: number): Promise<void> {
        const cutoffDateUTC = Date.now();
        const cutoffDate = new Date(cutoffDateUTC - days * 24 * 60 * 60 * 1000);
        const cutoffIso = cutoffDate.toISOString();

        const live = await getLiveSessionIds();
        const oldSessions = (
            await db.audioSessions.where("createdAt").below(cutoffIso).toArray()
        ).filter((s) => !live.has(s.id));

        for (const session of oldSessions) {
            await this.deleteUnownedSession(session.id);
        }
    }
}
