import { type AudioSession, db } from "./db";

export class AudioStorageService {
    // Generate unique ID
    private generateId(): string {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    public async createSession(name: string, mimeType: string): Promise<string> {
        const id = this.generateId();
        const now = new Date(Date.now()).toISOString();

        await db.audioSessions.add({
            id,
            name,
            createdAt: now,
            blobCount: 0,
            totalSize: 0,
            blobIds: [],
            mimeType,
        });

        return id;
    }

    public async storeAudioBlob(
        sessionId: string,
        blob: Blob,
        name?: string,
        duration?: number,
    ): Promise<string> {
        const id = this.generateId();
        const now = new Date().toISOString();

        const session = await db.audioSessions.get(sessionId);
        if (!session) {
            throw new Error(`Session with ID ${sessionId} not found`);
        }

        await db.transaction(
            "rw",
            db.audioBlobs,
            db.audioSessions,
            async () => {
                await db.audioBlobs.add({
                    id,
                    sessionId,
                    createdAt: now,
                    duration,
                    name,
                    size: blob.size,
                    type: blob.type,
                    blob,
                });

                // Update session metadata
                session.blobCount += 1;
                session.totalSize += blob.size;
                session.blobIds.push(id);

                await db.audioSessions.put(session);
            },
        );

        return id;
    }

    public async getSessionBlobs(sessionId: string): Promise<Blob[]> {
        const blobs = await db.audioBlobs
            .where("sessionId")
            .equals(sessionId)
            .toArray();

        return blobs.map((b) => b.blob);
    }

    public async getAllSessions(): Promise<AudioSession[]> {
        const sessions = await db.audioSessions
            .where("blobCount")
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
            db.audioBlobs,
            db.audioSessions,
            async () => {
                // Delete all associated blobs
                await db.audioBlobs
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
            .where("blobCount")
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
