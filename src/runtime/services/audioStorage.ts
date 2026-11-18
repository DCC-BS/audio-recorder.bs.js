import { acquireSessionLock, getLiveSessionIds } from "../utils/sessionLock";
import {
    type AudioSession,
    type AudioSessionStatus,
    db,
    newestPaused,
} from "./db";

/** Another page is recording the session. */
export class SessionInUse extends Error {}

/** The session got new audio since the caller read it. */
export class SessionChanged extends Error {}

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
        return newestPaused(await this.getResumableSessions());
    }

    /**
     * The chunks in `chunkIds` order: ids start with a timestamp, so a clock
     * set back during a pause would otherwise reorder them.
     */
    /**
     * Joins a stored session into one MP3.
     *
     * @param concatMp3 - Joins MP3 chunks, from `useFFmpeg`.
     * @returns The MP3 and the number of chunks in it, to pass to
     *   `markAsStopped` or `deleteStoredSession` afterwards.
     */
    public async exportSession(
        sessionId: string,
        concatMp3: (chunks: ArrayBuffer[]) => Promise<Blob>,
    ): Promise<{ mp3Blob: Blob; chunkCount: number }> {
        const chunks = await this.getSessionChunks(sessionId);
        if (chunks.length === 0) {
            throw new Error(`Session with ID ${sessionId} has no audio`);
        }
        return { mp3Blob: await concatMp3(chunks), chunkCount: chunks.length };
    }

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
     *
     * @param expectedChunkCount - The chunk count of the audio handed on.
     * @throws SessionInUse, SessionChanged
     */
    public async markAsStopped(
        sessionId: string,
        expectedChunkCount?: number,
    ): Promise<void> {
        await this.withUnchangedSession(sessionId, expectedChunkCount, () =>
            this.setSessionStatus(sessionId, "stopped"),
        );
    }

    /**
     * Deletes a session the user picked from a (possibly stale) list. A
     * recorder deletes its own session with `deleteSession`.
     *
     * @param expectedChunkCount - The chunk count of the audio the caller
     *   kept (e.g. uploaded); newer audio is not deleted with it.
     * @throws SessionInUse, SessionChanged
     */
    public async deleteStoredSession(
        sessionId: string,
        expectedChunkCount?: number,
    ): Promise<void> {
        await this.withUnchangedSession(sessionId, expectedChunkCount, () =>
            this.deleteSession(sessionId),
        );
    }

    /**
     * Runs `change` while holding the session's lock, so no recorder can
     * add audio meanwhile. Chunks are only ever appended, so the chunk
     * count tells whether the session changed since the caller read it.
     */
    private async withUnchangedSession(
        sessionId: string,
        expectedChunkCount: number | undefined,
        change: () => Promise<void>,
    ): Promise<void> {
        const release = await acquireSessionLock(sessionId);
        if (!release) {
            throw new SessionInUse(
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
                throw new SessionChanged(
                    `Session with ID ${sessionId} got new audio meanwhile`,
                );
            }
            await change();
        } finally {
            release();
        }
    }

    /** Deletes a session unless a recorder owns it, holding its lock meanwhile. */
    private async deleteUnownedSession(sessionId: string): Promise<void> {
        const release = await acquireSessionLock(sessionId);
        if (!release) {
            return;
        }
        try {
            await this.deleteSession(sessionId);
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
