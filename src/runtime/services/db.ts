import Dexie, { type EntityTable } from "dexie";

export interface AudioChunk {
    id: string;
    sessionId: string;
    createdAt: string;
    buffer: ArrayBuffer;
}

export interface AudioSession {
    id: string;
    name?: string;
    createdAt: string;
    chunkCount: number;
    totalSize: number;
    chunkIds: string[];
    sampleRate: number;
    numChannels: number;
}

const db = new Dexie("AudioRecorderDB") as Dexie & {
    audioChunks: EntityTable<AudioChunk, "id">;
    audioSessions: EntityTable<AudioSession, "id">;
};

db.version(1).stores({
    audioBlobs: "id, sessionId, createdAt, name, size, type",
    audioSessions: "id, createdAt, chunkCount, totalSize",
});

db.version(2)
    .stores({
        audioChunks: "id, sessionId, createdAt",
        audioSessions: "id, createdAt, chunkCount, totalSize",
        audioBlobs: null,
    })
    .upgrade((tx) => {
        return tx
            .table("audioSessions")
            .toCollection()
            .modify((session) => {
                delete session.blobCount;
                delete session.blobIds;
                session.chunkIds = [];
                session.chunkCount = 0;
            });
    });

export { db };
