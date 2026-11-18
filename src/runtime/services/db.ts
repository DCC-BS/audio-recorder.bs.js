import Dexie, { type EntityTable } from "dexie";

export interface AudioChunk {
    id: string;
    sessionId: string;
    createdAt: string;
    buffer: ArrayBuffer;
}

/**
 * `recording` (interrupted when no page owns it, see sessionLock), `paused`,
 * or `stopped` (ended, kept only as a backup).
 */
export type AudioSessionStatus = "recording" | "paused" | "stopped";

export interface AudioSession {
    id: string;
    name?: string;
    createdAt: string;
    chunkCount: number;
    totalSize: number;
    chunkIds: string[];
    sampleRate: number;
    numChannels: number;
    /** Missing on sessions stored before version 3: treat as `recording`. */
    status?: AudioSessionStatus;
    duration?: number;
    pausedAt?: string;
    /** Free-form tag, e.g. "microphone" or "meeting". */
    source?: string;
}

/** Paused and interrupted sessions may be continued, stopped ones not. */
export function isResumable(session: Pick<AudioSession, "status">): boolean {
    return session.status !== "stopped";
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
                session.numChannels = 1;
                session.sampleRate = 44100;
            });
    });

// chunks are MP3 at 64 kbit/s, i.e. 8000 bytes per second
export const MP3_BYTES_PER_SECOND = 8000;

db.version(3)
    .stores({
        audioChunks: "id, sessionId, createdAt",
        audioSessions: "id, createdAt, chunkCount, totalSize, status",
    })
    .upgrade((tx) => {
        return tx
            .table("audioSessions")
            .toCollection()
            .modify((session: AudioSession) => {
                // everything stored so far was cut off mid-recording
                session.status = "recording";
                session.duration = session.totalSize / MP3_BYTES_PER_SECOND;
            });
    });

export { db };
