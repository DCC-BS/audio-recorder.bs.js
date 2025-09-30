import { onMounted, ref } from "vue";
import { AudioStorageService } from "../services/audioStorage";
import type { AudioSession } from "../services/db";
import { useFFmpeg } from "./audioConversion";

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

export async function getAbandonedRecording(): Promise<AudioSession[]> {
    const audioStorage = new AudioStorageService();
    return audioStorage.getAllSessions();
}

export function useAudioSessions(options: AudioSessionOptions = {}) {
    const opt = { ...optionsDefault, ...options };

    const isReady = ref(false);
    const audioStorage = new AudioStorageService();
    const abandonedRecording = ref<AudioSession[] | undefined>(undefined);

    const { convertWebmToMp3 } = useFFmpeg(opt.logger);

    onMounted(async () => {
        await audioStorage.clearSessionsOlderThan(
            opt.deleteOldSessionsDaysInterval,
        ); // days

        await audioStorage.clearSessionOverThreshold(opt.maxSessionsToKeep);
        abandonedRecording.value = await audioStorage.getAllSessions();
        isReady.value = true;
    });

    async function getWebmBlob(sessionId: string): Promise<Blob> {
        const blobs = await audioStorage.getSessionBlobs(sessionId);
        return new Blob(blobs, { type: "audio/webm" });
    }

    async function getMp3Blob(sessionId: string): Promise<Blob> {
        const blobs = await audioStorage.getSessionBlobs(sessionId);
        const webmBlob = new Blob(blobs, { type: "audio/webm" });
        const mp3Blob = await convertWebmToMp3(webmBlob, "recording");
        return mp3Blob;
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
        getWebmBlob,
        getMp3Blob,
        deleteAbandonedRecording,
    };
}
