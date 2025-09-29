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
    blobCount: number;
    totalSize: number;
    blobIds: string[];
}
declare const db: Dexie & {
    audioBlobs: EntityTable<AudioBlob, "id">;
    audioSessions: EntityTable<AudioSession, "id">;
};
export { db };
