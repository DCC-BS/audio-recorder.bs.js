import Dexie, { type EntityTable } from "dexie";

export interface AudioChunk {
    id: string;
    sessionId: string;
    createdAt: string;
    buffer: ArrayBuffer;
}

/**
 * Where a stored session stands.
 *
 * - `recording`: being recorded. When no recorder owns it (see
 *   `AudioStorageService.isSessionLive`), the recording was interrupted (crash,
 *   closed tab) and can be resumed.
 * - `paused`: the user (or an interruption) paused it; it waits to be resumed.
 * - `stopped`: the user ended it; kept only as a backup.
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
    /** Seconds of audio stored so far. */
    duration?: number;
    /** When the session was last paused (ISO string). */
    pausedAt?: string;
    /** Free-form tag of what recorded it, e.g. "microphone" or "meeting". */
    source?: string;
}

/**
 * Whether a stored session may be continued: paused or interrupted ones
 * (including rows from before version 3, which have no status) may, the
 * backup of an ended recording may not.
 *
 * @param session - The stored session.
 */
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
