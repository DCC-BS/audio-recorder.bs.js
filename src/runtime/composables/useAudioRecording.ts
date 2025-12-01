import { onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { AudioStorageService } from "../services/audioStorage";
import {
    checkMicrophoneAvailability,
    handleMicrophoneError,
} from "../utils/microphone";
import { toPcmData } from "../utils/pcm";
import { useFFmpeg } from "./useFFmpeg";
import { useRecordingTime } from "./useRecodingTime";
import { startPcmRecorder, type PCMRecorder } from "../utils/recorderService";

/**
 * Options for audio recording
 * @property onRecordingStarted - Callback when recording starts, providing the MediaStream
 * @property storeToDbInterval - Interval in seconds to store audio blobs to the database (default: 30000 (30 seconds))
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
    onRecordingStarted: () => {},
    onRecordingStopped: () => {},
    onError: () => {},
    storeToDbInterval: 30, // 30 seconds
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
export function useAudioRecording(options: RecodingOptions = {}) {
    const opt = { ...optionsDefault, ...options };
    const { t } = useI18n();
    const { concatMp3, pcmToMp3 } = useFFmpeg(opt.logger);
    const { startTime, stopTime, recordingTime } = useRecordingTime();

    // outputs
    const isLoading = ref(false);
    const isRecording = ref(false);
    const isProcessing = ref(false);

    const error = ref<string>();
    const audioBlob = ref<Blob>();
    const audioUrl = ref<string>();

    const audioStorage = new AudioStorageService();
    const currentSession = ref<string>();

    let pcmRecorder: PCMRecorder | undefined;

    let pcmArrays: Float32Array[] = [];
    let totalSamples = 0;

    onUnmounted(() => {
        if (pcmRecorder) {
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

        resetRecording();

        try {
            pcmRecorder = await startPcmRecorder();

            currentSession.value = await audioStorage.createSession(
                `${t("audio-recorder.audio.newRecording", { date: new Date().toLocaleString() })}`,
                pcmRecorder.sampleRate,
                1,
            );

            // Initialize visualization
            opt.onRecordingStarted(pcmRecorder.stream);

            // Update UI state
            isLoading.value = false;
            isRecording.value = true;

            startTime();

            let debugCounter = 0;
            let startUsage = 0;

            navigator.storage.estimate().then((estimate) => {
                if (!estimate.usage) {
                    return;
                }
                startUsage = estimate.usage / (1024 * 1024);
            });

            const sampleRate = pcmRecorder.sampleRate;

            // Receive raw PCM frames from the worklet
            pcmRecorder.onPCMData(async (pcmData: Float32Array) => {
                pcmArrays.push(pcmData);
                totalSamples += pcmData.length;

                // Calculate total duration of accumulated PCM data
                const durationInSeconds = totalSamples / sampleRate;

                if (durationInSeconds >= opt.storeToDbInterval) {
                    totalSamples = 0;
                    await appendMp3();
                }

                if (import.meta.env.DEV && debugCounter++ % 500 === 0) {
                    navigator.storage.estimate().then((estimate) => {
                        if (!estimate.quota || !estimate.usage) return;

                        const usageMB = estimate.usage / (1024 * 1024);
                        const quotaMB = (
                            estimate.quota /
                            (1024 * 1024)
                        ).toFixed(2);

                        const diff = usageMB - startUsage;
                        const diffGB = (diff / 1024).toFixed(2);

                        opt.logger(
                            `${recordingTime.value}: Using ${usageMB.toFixed(2)} MB out of ${quotaMB} MB. Diff: ${diff.toFixed(2)} MB (${diffGB} GB)`,
                        );

                        console.debug(
                            `${recordingTime.value}: Using ${usageMB.toFixed(2)} MB out of ${quotaMB} MB. Diff: ${diff.toFixed(2)} MB (${diffGB} GB)`,
                        );
                    });
                }
            });
        } catch (e) {
            console.error(e);
            error.value = handleMicrophoneError(e as Error);
        }
    }

    async function appendMp3() {
        if (!pcmRecorder) {
            throw new Error("pcmRecorder is not initialized");
        }

        const data = toPcmData(pcmArrays);
        totalSamples = 0;
        pcmArrays = [];

        const mp3Blob = await pcmToMp3(data, pcmRecorder.sampleRate, 1);

        audioStorage
            .storeAudioChunk(currentSession.value as string, mp3Blob)
            .catch((e) => {
                console.error("Error storing audio chunk:", e);
            });
    }

    async function stopRecording(): Promise<void> {
        await appendMp3();
        await abortRecording();
        isProcessing.value = true;

        if (!currentSession.value) {
            throw new Error("No active session for recording");
        }

        const session = await audioStorage.getSession(currentSession.value);
        if (!session) {
            throw new Error(
                `Session with ID ${currentSession.value} not found`,
            );
        }

        const blobs = await audioStorage.getSessionChunks(currentSession.value);

        const mp3Blob = await concatMp3(blobs);

        audioBlob.value = mp3Blob;
        audioUrl.value = URL.createObjectURL(mp3Blob);

        if (!currentSession.value) {
            throw new Error("No active session for recording");
        }
        // Update state with processed audio

        audioStorage.deleteSession(currentSession.value);
        opt.onRecordingStopped(audioBlob.value, audioUrl.value);

        isProcessing.value = false;
    }

    async function abortRecording(): Promise<void> {
        if (!pcmRecorder) {
            console.error("pcmRecorder is not initialized");

            throw new Error("invalid state");
        }

        isRecording.value = false;

        await pcmRecorder.stop();

        // Clear references
        pcmRecorder = undefined;

        // Clear recording timer
        stopTime();
    }

    function resetRecording(): void {
        audioBlob.value = undefined;
        audioUrl.value = "";
        error.value = "";
        pcmArrays = [];
        totalSamples = 0;
        pcmRecorder = undefined;
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
        error,
    };
}
