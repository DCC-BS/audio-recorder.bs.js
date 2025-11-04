import type { AudioSession } from "../services/db.js";
/**
 * Options for audio recording
 * @property onRecordingStarted - Callback when recording starts, providing the MediaStream
 * @property storeToDbInterval - Interval in milliseconds to store audio blobs to the database (default: 30000 (30 seconds))
 * @property mimeType - MIME type for the MediaRecorder (default: "audio/webm;codecs=opus")
 * @property deleteOldSessionsDaysInterval - Number of days to keep old sessions before deletion (default: 7)
 */
export type AudioSessionOptions = {
    deleteOldSessionsDaysInterval?: number;
    maxSessionsToKeep?: number;
    logger?: (msg: string) => void;
};
export declare function getAbandonedRecording(): Promise<AudioSession[]>;
export declare function useAudioSessions(options?: AudioSessionOptions): {
    isReady: import("vue").Ref<boolean, boolean>;
    abandonedRecording: import("vue").Ref<{
        id: string;
        name?: string | undefined;
        createdAt: string;
        blobCount: number;
        totalSize: number;
        blobIds: string[];
    }[] | undefined, AudioSession[] | {
        id: string;
        name?: string | undefined;
        createdAt: string;
        blobCount: number;
        totalSize: number;
        blobIds: string[];
    }[] | undefined>;
    getWebmBlob: (sessionId: string) => Promise<Blob>;
    getMp3Blob: (sessionId: string) => Promise<Blob>;
    deleteAbandonedRecording: (sessionId: string) => Promise<void>;
};
