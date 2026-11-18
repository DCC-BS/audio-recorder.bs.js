import { computed, onMounted, ref } from "vue";
import { AudioStorageService } from "../services/audioStorage";
import type { AudioSession } from "../services/db";
import { useFFmpeg } from "./useFFmpeg";

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

const optionsDefault: Required<AudioSessionOptions> = {
    deleteOldSessionsDaysInterval: 7,
    maxSessionsToKeep: 10,
    logger: (_: string) => {},
};

/**
 * Lists the stored recordings no tab is recording right now: paused,
 * interrupted (crash, closed tab) and stopped ones. Newest first.
 */
export async function getAbandonedRecording(): Promise<AudioSession[]> {
    const audioStorage = new AudioStorageService();
    return audioStorage.getResumableSessions();
}

/**
 * The paused recording waiting to be continued, if any.
 */
export async function getPausedRecording(): Promise<AudioSession | undefined> {
    const audioStorage = new AudioStorageService();
    return audioStorage.getPausedSession();
}

export function useAudioSessions(options: AudioSessionOptions = {}) {
    const opt = { ...optionsDefault, ...options };
    const { concatMp3 } = useFFmpeg(opt.logger);

    const isReady = ref(false);
    const audioStorage = new AudioStorageService();
    const abandonedRecording = ref<AudioSession[] | undefined>(undefined);
    /** The paused recording waiting to be continued, if any. */
    const pausedRecording = computed(() =>
        abandonedRecording.value
            ?.filter((s) => s.status === "paused")
            .sort((a, b) =>
                (b.pausedAt ?? b.createdAt).localeCompare(
                    a.pausedAt ?? a.createdAt,
                ),
            )
            .at(0),
    );

    onMounted(async () => {
        await audioStorage.clearSessionsOlderThan(
            opt.deleteOldSessionsDaysInterval,
        ); // days

        await audioStorage.clearSessionOverThreshold(opt.maxSessionsToKeep);
        await refresh();
        isReady.value = true;
    });

    /**
     * Reloads the stored recordings, e.g. after one was continued.
     */
    async function refresh(): Promise<void> {
        abandonedRecording.value = await audioStorage.getResumableSessions();
    }

    async function getMp3Blob(sessionId: string): Promise<Blob> {
        const session = await audioStorage.getSession(sessionId);

        if (!session) {
            throw new Error(`Session with ID ${sessionId} not found`);
        }

        const mp3Chunks = await audioStorage.getSessionChunks(sessionId);

        const mp3Blob = await concatMp3(mp3Chunks);
        return mp3Blob;
    }

    /**
     * Ends a stored recording without deleting it: it can no longer count
     * as paused, but stays available as a backup until the usual cleanup.
     * Use it once a paused recording was handed on, e.g. for processing.
     *
     * @param sessionId - The stored recording.
     */
    async function markAsStopped(sessionId: string): Promise<void> {
        await audioStorage.markAsStopped(sessionId);
        await refresh();
    }

    async function deleteAbandonedRecording(sessionId: string): Promise<void> {
        await audioStorage.deleteSession(sessionId);

        if (abandonedRecording.value) {
            abandonedRecording.value = abandonedRecording.value.filter(
                (s) => s.id !== sessionId,
            );
        }
    }

    return {
        isReady,
        abandonedRecording,
        pausedRecording,
        refresh,
        markAsStopped,
        getMp3Blob,
        deleteAbandonedRecording,
    };
}
