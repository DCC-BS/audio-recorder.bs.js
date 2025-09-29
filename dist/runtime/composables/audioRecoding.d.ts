import { AudioStorageService } from "../services/audioStorage.js";
import type { AudioSession } from "../services/db.js";
/**
 * Options for audio recording
 * @property onRecordingStarted - Callback when recording starts, providing the MediaStream
 * @property storeToDbInterval - Interval in milliseconds to store audio blobs to the database (default: 30000 (30 seconds))
 * @property mimeType - MIME type for the MediaRecorder (default: "audio/webm;codecs=opus")
 * @property deleteOldSessionsDaysInterval - Number of days to keep old sessions before deletion (default: 7)
 */
export type Options = {
    onRecordingStarted?: (stream: MediaStream) => void;
    onRecordingStopped?: (audioBlob: Blob, audioUrl: string) => void;
    onError?: (error: string) => void;
    storeToDbInterval?: number;
    mimeType?: string;
    deleteOldSessionsDaysInterval?: number;
    logger?: (msg: string) => void;
};
/**
 * Composable for audio recording using MediaRecorder API
 * Handles microphone access, recording state, and audio storage
 *
 * @param options - Configuration options for recording
 * @returns Object containing recording state, controls, and recorded audio data
 *
 * @example
 * ```
 * const stream = ref<MediaStream>();
 * const {
 *     isRecording,
 *     startRecording,
 *     stopRecording,
 *     recordingTime,
 *     error,
 *     audioUrl,
 * } = useAudioRecording({
 *     onRecordingStarted: (s: MediaStream) => {
 *         stream.value = s;
 *     },
 * });
 * ```
 */
export declare function useAudioRecording(options?: Options): {
    isLoading: import("vue").Ref<boolean, boolean>;
    isRecording: import("vue").Ref<boolean, boolean>;
    recordingTime: import("vue").Ref<number, number>;
    startRecording: () => Promise<void>;
    stopRecording: () => void;
    audioBlob: import("vue").Ref<Blob | undefined, Blob | undefined>;
    audioUrl: import("vue").Ref<string | undefined, string | undefined>;
    currentSession: import("vue").Ref<string | undefined, string | undefined>;
    audioStorage: AudioStorageService;
    resetRecording: () => void;
    mediaRecorder: import("vue").Ref<MediaRecorder | undefined, MediaRecorder | undefined>;
    recordingInterval: import("vue").Ref<NodeJS.Timeout | undefined, NodeJS.Timeout | undefined>;
    recordingStartTime: import("vue").Ref<number, number>;
    elapsedTime: import("vue").Ref<number, number>;
    error: import("vue").Ref<string | undefined, string | undefined>;
    abandonedRecording: import("vue").Ref<{
        id: string;
        name?: string | undefined;
        createdAt: string;
        blobCount: number;
        totalSize: number;
        blobIds: string[];
    }[], AudioSession[] | {
        id: string;
        name?: string | undefined;
        createdAt: string;
        blobCount: number;
        totalSize: number;
        blobIds: string[];
    }[]>;
    getWebmBlob: (sessionId: string) => Promise<Blob>;
    getMp3Blob: (sessionId: string) => Promise<Blob>;
    deleteAbandonedRecording: (sessionId: string) => Promise<void>;
};
