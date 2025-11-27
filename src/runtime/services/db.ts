import Dexie, { type EntityTable } from "dexie";

export interface AudioChunk {
    id: string;
    sessionId: string;
    createdAt: string;
    floats: Float32Array;
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

db.version(2).stores({
    audioChunks: "id, sessionId, createdAt",
    audioSessions: "id, createdAt, updatedAt, chunkCount, totalSize",
});

export { db };
