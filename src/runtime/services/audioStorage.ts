import { type AudioSession, db } from "./db";

export class AudioStorageService {
    // Generate unique ID
    private generateId(): string {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    public async createSession(name: string, sampleRate: number, numChannels: number): Promise<string> {
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
        });

        return id;
    }

    public async storeAudioChunk(
        sessionId: string,
        floats: Float32Array,
    ): Promise<string> {
        const id = this.generateId();
        const now = new Date().toISOString();

        const session = await db.audioSessions.get(sessionId);
        if (!session) {
            throw new Error(`Session with ID ${sessionId} not found`);
        }

        await db.transaction(
            "rw",
            db.audioChunks,
            db.audioSessions,
            async () => {
                await db.audioChunks.add({
                    id,
                    sessionId,
                    createdAt: now,
                    floats,
                });

                // Update session metadata
                session.chunkCount += 1;
                session.totalSize += floats.length;
                session.chunkIds.push(id);

                await db.audioSessions.put(session);
            },
        );

        return id;
    }

    public async getSession(sessionId: string): Promise<AudioSession | undefined> {
        return db.audioSessions.get(sessionId);
    }

    public async getSessionChunks(sessionId: string): Promise<Float32Array[]> {
        const chunks = await db.audioChunks
            .where("sessionId")
            .equals(sessionId)
            .toArray();

        return chunks.map((c) => c.floats);
    }

    public async getPcmData(sessionId: string) : Promise<Float32Array> { 
        const chunks = await this.getSessionChunks(sessionId);
        const length = chunks.reduce(
            (acc: number, arr: Float32Array) => acc + arr.length,
            0,
        );
        const pcmData = new Float32Array(length);
        let offset = 0;
        for (const chunk of chunks) {
            pcmData.set(chunk, offset);
            offset += chunk.length;
        }

        return pcmData;
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

    public async clearSessionOverThreshold(maxSessions: number): Promise<void> {
        const sessions = await db.audioSessions
            .where("chunkCount")
            .aboveOrEqual(1)
            .sortBy("createdAt");

        if (sessions.length <= maxSessions) {
            return; // Nothing to delete
        }

        const sessionsToDelete = sessions.slice(
            0,
            sessions.length - maxSessions,
        );

        for (const session of sessionsToDelete) {
            await this.deleteSession(session.id);
        }
    }

    public async clearSessionsOlderThan(days: number): Promise<void> {
        const cutoffDateUTC = Date.now();
        const cutoffDate = new Date(cutoffDateUTC - days * 24 * 60 * 60 * 1000);
        const cutoffIso = cutoffDate.toISOString();

        const oldSessions = await db.audioSessions
            .where("createdAt")
            .below(cutoffIso)
            .toArray();

        for (const session of oldSessions) {
            await this.deleteSession(session.id);
        }
    }
}
