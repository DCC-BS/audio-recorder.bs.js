import { onUnmounted, ref } from "vue";
import { AudioStorageService } from "../services/audioStorage";
import type { AudioSession } from "../services/db";
import {
    checkMicrophoneAvailability,
    handleMicrophoneError,
} from "../utils/microphone";
import { useFFmpeg } from "./audioConversion";
import { useI18n } from "vue-i18n";
/**
 * Options for audio recording
 * @property onRecordingStarted - Callback when recording starts, providing the MediaStream
 * @property storeToDbInterval - Interval in milliseconds to store audio blobs to the database (default: 30000 (30 seconds))
 * @property mimeType - MIME type for the MediaRecorder (default: "audio/webm;codecs=opus")
 */
export type RecodingOptions = {
    onRecordingStarted?: (stream: MediaStream) => void;
    onRecordingStopped?: (audioBlob: Blob, audioUrl: string) => void;
    onError?: (error: string) => void;
    storeToDbInterval?: number;
    logger?: (msg: string) => void;
};

const optionsDefault: Required<RecodingOptions> = {
    onRecordingStarted: () => { },
    onRecordingStopped: () => { },
    onError: () => { },
    storeToDbInterval: 30000, // 30000
    logger: (_: string) => { },
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
export function useAudioRecording(options: RecodingOptions = {}) {
    const opt = { ...optionsDefault, ...options };
    const { t } = useI18n();
    const { convertAudioToMp3 } = useFFmpeg(opt.logger);
    const isLoading = ref(false);
    const isRecording = ref(false);
    const isProcessing = ref(false);
    const mediaRecorder = ref<MediaRecorder>();
    const audioStorage = new AudioStorageService();

    const recordingStartTime = ref(0);
    const recordingTime = ref(0);
    const elapsedTime = ref(0);

    const recordingInterval = ref<NodeJS.Timeout>();
    const currentSession = ref<string>();

    const audioBlob = ref<Blob>();
    const audioUrl = ref<string>();

    const error = ref<string>();
    const abandonedRecording = ref<AudioSession[] | undefined>(undefined);

    let waitForAudioStoragePromise: Promise<void> | undefined;

    onUnmounted(() => {
        if (isRecording.value) {
            abortRecording();
        }
    });

    async function startRecording() {
        const availabilityResult = await checkMicrophoneAvailability();
        if (!availabilityResult.isAvailable) {
            error.value =
                availabilityResult.message || "Microphone not available";
            isLoading.value = false;
            return;
        }

        error.value = "";

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
            });

            currentSession.value = await audioStorage.createSession(
                `${t('audio-recorder.audio.newRecording', { date: new Date().toLocaleString() })}`,
                mediaRecorder.value?.mimeType ?? "audio/webm"
            );

            // Initialize visualization
            opt.onRecordingStarted(stream);

            // Update UI state
            isLoading.value = false;
            isRecording.value = true;

            // Create a new MediaRecorder instance
            mediaRecorder.value = new MediaRecorder(stream);

            // Setup for iOS background audio
            if ("mediaSession" in navigator) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: "Active Recording",
                    artist: "Transcribo",
                    album: "Transcribo",
                });

                navigator.mediaSession.playbackState = "none";
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

    function abortRecording(): void {
        if (mediaRecorder.value && isRecording.value) {
            isRecording.value = false;
            mediaRecorder.value.onstop = null;
            mediaRecorder.value.stop();
        }
    }

    async function handleRecordingDataAvailable(
        event: BlobEvent,
    ): Promise<void> {
        if (event.data.size > 0) {
            let resolve: () => void = () => { };
            let reject: (reason?: unknown) => void = () => { };

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
            isProcessing.value = true;

            // Release microphone
            for (const track of stream.getTracks()) {
                track.stop();
            }
            
            await waitForAudioStoragePromise;

            if (!currentSession.value) {
                throw new Error("No active session for recording");
            }

            // Convert webm to mp3 format
            const blobs = await audioStorage.getSessionBlobs(
                currentSession.value,
            );

            opt.logger(`Number of blobs: ${blobs.length}`);

            const inputBlob = new Blob(blobs, { type: mediaRecorder.value?.mimeType });
            const mp3Blob = await convertAudioToMp3(inputBlob, "recording");

            // Update state with processed audio
            audioBlob.value = mp3Blob;
            audioUrl.value = URL.createObjectURL(mp3Blob);

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
        } finally {
            isProcessing.value = false;
        }
    }

    function resetRecording(): void {
        audioBlob.value = undefined;
        audioUrl.value = "";
        error.value = "";
        recordingTime.value = 0;
    }

    return {
        isLoading,
        isRecording,
        isProcessing,
        recordingTime,
        startRecording,
        stopRecording,
        audioBlob,
        audioUrl,
        currentSession,
        resetRecording,
        mediaRecorder,
        recordingInterval,
        recordingStartTime,
        elapsedTime,
        error,
        abandonedRecording,
    };
}
