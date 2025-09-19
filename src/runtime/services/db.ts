import Dexie, { type EntityTable } from "dexie";

export interface AudioBlob {
    id: string;
    sessionId: string;
    createdAt: string;
    duration?: number;
    name?: string;
    size: number;
    type: string;
    blob: Blob;
}

export interface AudioSession {
    id: string;
    name?: string;
    createdAt: string;
    updatedAt: string;
    blobCount: number;
    totalSize: number;
    blobIds: string[];
}

const db = new Dexie("AudioRecorderDB") as Dexie & {
    audioBlobs: EntityTable<AudioBlob, "id">;
    audioSessions: EntityTable<AudioSession, "id">;
};

db.version(1).stores({
    audioBlobs: "id, sessionId, createdAt, name, size, type",
    audioSessions: "id, createdAt, updatedAt, blobCount, totalSize",
});

export { db };
