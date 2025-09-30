import { type AudioSession } from "./db.js";
export declare class AudioStorageService {
    private generateId;
    createSession(name?: string): Promise<string>;
    storeAudioBlob(sessionId: string, blob: Blob, name?: string, duration?: number): Promise<string>;
    getSessionBlobs(sessionId: string): Promise<Blob[]>;
    getAllSessions(): Promise<AudioSession[]>;
    deleteSession(sessionId: string): Promise<void>;
    clearSessionOverThreshold(maxSessions: number): Promise<void>;
    clearSessionsOlderThan(days: number): Promise<void>;
}
