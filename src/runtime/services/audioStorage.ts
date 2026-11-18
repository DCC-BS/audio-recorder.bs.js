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

    /** @param duration - Seconds of audio in the chunk. */
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
                // read inside the transaction: the status may have changed
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

    public async setSessionStatus(
        sessionId: string,
        status: AudioSessionStatus,
    ): Promise<void> {
        await db.transaction("rw", db.audioSessions, async () => {
            const session = await db.audioSessions.get(sessionId);
            if (!session) {
                throw new Error(`Session with ID ${sessionId} not found`);
            }
            const changes: Partial<AudioSession> = { status };
            // only on the change, so a repeated write keeps the old time
            if (status === "paused" && session.status !== "paused") {
                changes.pausedAt = new Date().toISOString();
            }
            await db.audioSessions.update(sessionId, changes);
        });
    }

    /** Stored sessions no page is recording right now, newest first. */
    public async getResumableSessions(): Promise<AudioSession[]> {
        const [sessions, live] = await Promise.all([
            this.getAllSessions(),
            getLiveSessionIds(),
        ]);
        return sessions
            .filter((s) => !live.has(s.id))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    /** The most recently paused session, if any. */
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

    /**
     * The chunks in `chunkIds` order: ids start with a timestamp, so a clock
     * set back during a pause would otherwise reorder them.
     */
    public async getSessionChunks(sessionId: string): Promise<ArrayBuffer[]> {
        return db.transaction(
            "r",
            db.audioChunks,
            db.audioSessions,
            async () => {
                const [session, chunks] = await Promise.all([
                    db.audioSessions.get(sessionId),
                    db.audioChunks
                        .where("sessionId")
                        .equals(sessionId)
                        .toArray(),
                ]);
                const order = session?.chunkIds ?? [];
                // old rows without a complete chunkIds keep the index order
                if (order.length !== chunks.length) {
                    return chunks.map((c) => c.buffer);
                }
                const byId = new Map(chunks.map((c) => [c.id, c.buffer]));
                return order.flatMap((id) => {
                    const buffer = byId.get(id);
                    return buffer ? [buffer] : [];
                });
            },
        );
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
     * Keeps a handed-on session as a backup that can no longer be continued.
     * Refuses if another page records it, or if it no longer has
     * `expectedChunkCount` chunks (continued elsewhere since).
     */
    public async markAsStopped(
        sessionId: string,
        expectedChunkCount?: number,
    ): Promise<void> {
        const release = await acquireSessionLock(sessionId);
        if (!release) {
            throw new Error(
                `Session with ID ${sessionId} is being recorded elsewhere`,
            );
        }
        try {
            const session = await db.audioSessions.get(sessionId);
            if (!session) {
                throw new Error(`Session with ID ${sessionId} not found`);
            }
            if (
                expectedChunkCount !== undefined &&
                session.chunkCount !== expectedChunkCount
            ) {
                throw new Error(
                    `Session with ID ${sessionId} changed since it was handed on`,
                );
            }
            await this.setSessionStatus(sessionId, "stopped");
        } finally {
            release();
        }
    }

    /**
     * Deletes a session the user picked from a (possibly stale) list; refuses
     * if another page records it. A recorder deletes its own session with
     * `deleteSession`.
     */
    public async deleteStoredSession(sessionId: string): Promise<void> {
        if (!(await this.deleteUnownedSession(sessionId))) {
            throw new Error(
                `Session with ID ${sessionId} is being recorded elsewhere`,
            );
        }
    }

    /** Deletes a session unless a recorder owns it, holding its lock meanwhile. */
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
