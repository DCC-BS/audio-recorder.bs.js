import { computed, onMounted, ref } from "vue";
import { AudioStorageService } from "../services/audioStorage";
import { type AudioSession, newestPaused } from "../services/db";
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

/** Stored recordings no tab is recording right now, newest first. */
export async function getAbandonedRecording(): Promise<AudioSession[]> {
    const audioStorage = new AudioStorageService();
    return audioStorage.getResumableSessions();
}

/** The paused recording, if any. */
export async function getPausedRecording(): Promise<AudioSession | undefined> {
    const audioStorage = new AudioStorageService();
    return audioStorage.getPausedSession();
}

export function useAudioSessions(options: AudioSessionOptions = {}) {
    const opt = { ...optionsDefault, ...options };
    const { concatMp3 } = useFFmpeg(opt.logger);

    /** The stored recordings were read at least once. */
    const isReady = ref(false);
    /** The last attempt to read them failed; `refresh()` retries. */
    const loadFailed = ref(false);
    const audioStorage = new AudioStorageService();
    const abandonedRecording = ref<AudioSession[] | undefined>(undefined);
    const pausedRecording = computed(() =>
        newestPaused(abandonedRecording.value ?? []),
    );

    onMounted(async () => {
        // a failed cleanup only leaves old recordings around a while longer
        try {
            await audioStorage.clearSessionsOlderThan(
                opt.deleteOldSessionsDaysInterval,
            );
            await audioStorage.clearSessionOverThreshold(opt.maxSessionsToKeep);
        } catch (e) {
            opt.logger(`Cleaning up old recordings failed: ${e}`);
        }
        await refresh().catch(() => {});
    });

    // a delete invalidates refreshes still in flight: they may have read
    // the deleted session
    let generation = 0;

    /** Reads the stored recordings again; sets `isReady` or `loadFailed`. */
    async function refresh(): Promise<void> {
        const current = ++generation;
        let sessions: AudioSession[];
        try {
            sessions = await audioStorage.getResumableSessions();
        } catch (e) {
            loadFailed.value = true;
            throw e;
        }
        // an older read must not clear the failure of a newer one
        if (current === generation) {
            loadFailed.value = false;
            abandonedRecording.value = sessions;
            isReady.value = true;
        }
    }

    /**
     * Joins a stored session into one MP3.
     *
     * @returns The MP3 and the number of chunks in it, to pass to
     *   `markAsStopped` or `deleteAbandonedRecording` afterwards.
     */
    function exportSession(
        sessionId: string,
    ): Promise<{ mp3Blob: Blob; chunkCount: number }> {
        return audioStorage.exportSession(sessionId, concatMp3);
    }

    async function getMp3Blob(sessionId: string): Promise<Blob> {
        return (await exportSession(sessionId)).mp3Blob;
    }

    /** Keeps a handed-on recording as a backup; see AudioStorageService.markAsStopped. */
    async function markAsStopped(
        sessionId: string,
        expectedChunkCount?: number,
    ): Promise<void> {
        await audioStorage.markAsStopped(sessionId, expectedChunkCount);
        // the stop is done; a stale list is no reason to report it failed
        await refresh().catch((e) => {
            opt.logger(`Refreshing the stored recordings failed: ${e}`);
        });
    }

    /** See AudioStorageService.deleteStoredSession. */
    async function deleteAbandonedRecording(
        sessionId: string,
        expectedChunkCount?: number,
    ): Promise<void> {
        await audioStorage.deleteStoredSession(sessionId, expectedChunkCount);
        generation++;

        if (abandonedRecording.value) {
            abandonedRecording.value = abandonedRecording.value.filter(
                (s) => s.id !== sessionId,
            );
        }
    }

    return {
        isReady,
        loadFailed,
        abandonedRecording,
        pausedRecording,
        refresh,
        markAsStopped,
        getMp3Blob,
        exportSession,
        deleteAbandonedRecording,
    };
}
