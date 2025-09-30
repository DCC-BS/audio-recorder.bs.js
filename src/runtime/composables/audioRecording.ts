import { onMounted, ref } from "vue";
import { AudioStorageService } from "../services/audioStorage";
import type { AudioSession } from "../services/db";
import {
    checkMicrophoneAvailability,
    handleMicrophoneError,
} from "../utils/microphone";
import { useFFmpeg } from "./audioConversion";

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

const optionsDefault: Required<Options> = {
    onRecordingStarted: () => {},
    onRecordingStopped: () => {},
    onError: () => {},
    storeToDbInterval: 30000, // 30000
    mimeType: "audio/webm;codecs=opus",
    deleteOldSessionsDaysInterval: 7,
    logger: (_: string) => {},
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
export function useAudioRecording(options: Options = {}) {
    const opt = { ...optionsDefault, ...options };

    const { convertWebmToMp3 } = useFFmpeg(opt.logger);

    const audioStorage = new AudioStorageService();

    const isLoading = ref(false);
    const isRecording = ref(false);
    const mediaRecorder = ref<MediaRecorder>();

    const recordingStartTime = ref(0);
    const recordingTime = ref(0);
    const elapsedTime = ref(0);

    const recordingInterval = ref<NodeJS.Timeout>();
    const currentSession = ref<string>();

    const audioBlob = ref<Blob>();
    const audioUrl = ref<string>();

    const error = ref<string>();
    const abandonedRecording = ref<AudioSession[]>([]);

    let waitForAudioStoragePromise: Promise<void> | undefined;

    onMounted(async () => {
        await audioStorage.clearSessionsOlderThan(
            opt.deleteOldSessionsDaysInterval,
        ); // days
        abandonedRecording.value = await audioStorage.getAllSessions();
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
        abandonedRecording.value = abandonedRecording.value.filter(
            (s) => s.id !== sessionId,
        );
    }

    async function startRecording() {
        const availabilityResult = await checkMicrophoneAvailability();
        if (!availabilityResult.isAvailable) {
            error.value =
                availabilityResult.message || "Microphone not available";
            isLoading.value = false;
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
            });

            currentSession.value = await audioStorage.createSession(
                `New Recording ${new Date().toLocaleString()}`,
            );

            // Initialize visualization
            opt.onRecordingStarted(stream);

            // Update UI state
            isLoading.value = false;
            isRecording.value = true;

            // Create a new MediaRecorder instance
            mediaRecorder.value = new MediaRecorder(stream, {
                mimeType: options.mimeType,
            });

            // Setup for iOS background audio
            if ("mediaSession" in navigator) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: "Active Recording",
                    artist: "Transcribo",
                    album: "Transcribo",
                });
            }

            // Add event handlers
            mediaRecorder.value.ondataavailable = handleRecordingDataAvailable;
            mediaRecorder.value.onstop = async () =>
                await handleStopRecording(stream);

            // Start recording
            mediaRecorder.value.start(opt.storeToDbInterval);
            recordingStartTime.value = Date.now();
            recordingTime.value = 0;

            // Start the timer to display recording duration
            recordingInterval.value = setInterval(() => {
                recordingTime.value = Math.floor(
                    (Date.now() - recordingStartTime.value) / 1000 +
                        elapsedTime.value,
                );
            }, 1000);
        } catch (e) {
            error.value = handleMicrophoneError(e as Error);
        }
    }

    function stopRecording(): void {
        if (mediaRecorder.value && isRecording.value) {
            isRecording.value = false;
            mediaRecorder.value.stop();
        }
    }

    async function handleRecordingDataAvailable(
        event: BlobEvent,
    ): Promise<void> {
        if (event.data.size > 0) {
            let resolve: () => void = () => {};
            let reject: (reason?: unknown) => void = () => {};

            waitForAudioStoragePromise = new Promise((res, rej) => {
                resolve = res;
                reject = rej;
            });

            try {
                if (!currentSession.value) {
                    throw new Error("No active session for recording");
                }

                await audioStorage.storeAudioBlob(
                    currentSession.value,
                    event.data,
                );

                /**
                 * From my measurements:
                 * 0.32 MB average per minute
                 * 19.26 MB average per hour
                 * on Firefox there is a maximum of 10240 MB storage per origin
                 * => approx 531 hours of recordings
                 */

                if (import.meta.env.DEV) {
                    navigator.storage.estimate().then((estimate) => {
                        if (!estimate.quota || !estimate.usage) return;

                        const usageMB = (
                            estimate.usage /
                            (1024 * 1024)
                        ).toFixed(2);
                        const quotaMB = (
                            estimate.quota /
                            (1024 * 1024)
                        ).toFixed(2);
                        console.debug(
                            `Using ${usageMB} MB out of ${quotaMB} MB.`,
                        );
                    });
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                error.value = message;
                opt.onError(message);
                reject(e);
            } finally {
                resolve();
            }
        }
    }

    async function handleStopRecording(stream: MediaStream): Promise<void> {
        try {
            await waitForAudioStoragePromise;

            if (!currentSession.value) {
                throw new Error("No active session for recording");
            }

            // Convert webm to mp3 format
            const blobs = await audioStorage.getSessionBlobs(
                currentSession.value,
            );

            const webmBlob = new Blob(blobs, { type: options.mimeType });
            const mp3Blob = await convertWebmToMp3(webmBlob, "recording");

            // Update state with processed audio
            audioBlob.value = mp3Blob;
            audioUrl.value = URL.createObjectURL(mp3Blob);

            // Release microphone
            for (const track of stream.getTracks()) {
                track.stop();
            }

            // Clear recording timer
            if (recordingInterval.value) {
                clearInterval(recordingInterval.value);
                recordingInterval.value = undefined;
            }

            audioStorage.deleteSession(currentSession.value);

            opt.onRecordingStopped(audioBlob.value, audioUrl.value);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            error.value = message;
            opt.onError(message);
        }
    }

    function resetRecording(): void {
        audioBlob.value = undefined;
        audioUrl.value = "";
        recordingTime.value = 0;
    }

    return {
        isLoading,
        isRecording,
        recordingTime,
        startRecording,
        stopRecording,
        audioBlob,
        audioUrl,
        currentSession,
        audioStorage,
        resetRecording,
        mediaRecorder,
        recordingInterval,
        recordingStartTime,
        elapsedTime,
        error,
        abandonedRecording,
        getWebmBlob,
        getMp3Blob,
        deleteAbandonedRecording,
    };
}
