import { onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { AudioStorageService } from "../services/audioStorage";
import {
    checkMicrophoneAvailability,
    handleMicrophoneError,
} from "../utils/microphone";
import { toPcmData } from "../utils/pcm";
import { type PCMRecorder, startPcmRecorder } from "../utils/pcmRecorder";
import { useFFmpeg } from "./useFFmpeg";
import { useRecordingTime } from "./useRecodingTime";

/**
 * Options for audio recording
 * @property onRecordingStarted - Callback when recording starts, providing the MediaStream
 * @property onRecordingStopped - Callback when recording stops with the audio Blob and object URL
 * @property onError - Callback when an error occurs during recording
 * @property storeToDbInterval - Interval in seconds to store audio chunks to IndexedDB (default: 30)
 * @property onStore - Callback when an MP3 chunk is created during recording (fires every storeToDbInterval seconds)
 * @property logger - Custom logging function for debugging
 * @property disableDefaultStore - Disable the default IndexedDB storage. Useful when handling storage yourself via the onStore callback (default: false)
 */
export type RecordingOptions = {
    onRecordingStarted?: (stream: MediaStream) => void;
    onRecordingStopped?: (audioBlob: Blob, audioUrl: string) => void;
    onError?: (error: string) => void;
    storeToDbInterval?: number;
    onStore?: (mp3Blob: Blob) => void | Promise<void>;
    logger?: (msg: string) => void;
    disableDefaultStore?: boolean;
};

const optionsDefault: Required<RecordingOptions> = {
    onRecordingStarted: () => {},
    onRecordingStopped: () => {},
    onError: () => {},
    storeToDbInterval: 30, // 30 seconds
    onStore: () => {},
    logger: (_: string) => {},
    disableDefaultStore: false,
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
export function useAudioRecording(options: RecordingOptions = {}) {
    const opt = { ...optionsDefault, ...options };
    const { t } = useI18n();
    const { concatMp3, pcmToMp3 } = useFFmpeg(opt.logger);
    const { startTime, stopTime, recordingTime } = useRecordingTime();

    const isRecording = ref(false);
    const isProcessing = ref(false);
    const wasSuspended = ref(false);

    const error = ref<string>();
    const audioBlob = ref<Blob>();
    const audioUrl = ref<string>();

    const audioStorage = new AudioStorageService();
    const currentSession = ref<string>();

    let pcmRecorder: PCMRecorder | undefined;

    let pcmArrays: Float32Array[] = [];
    let totalSamples = 0;

    const handleVisibilityChange = async () => {
        if (pcmRecorder && isRecording.value) {
            await pcmRecorder.handleVisibilityChange();
        }
    };

    onUnmounted(() => {
        document.removeEventListener(
            "visibilitychange",
            handleVisibilityChange,
        );
        if (pcmRecorder) {
            abortRecording();
        }
    });

    async function startRecording() {
        const availabilityResult = await checkMicrophoneAvailability();
        if (!availabilityResult.isAvailable) {
            error.value =
                availabilityResult.message || "Microphone not available";
            return;
        }

        resetRecording();

        try {
            pcmRecorder = await startPcmRecorder();

            pcmRecorder.setLogger(opt.logger);
            pcmRecorder.setOnContextSuspended(() => {
                wasSuspended.value = true;
                opt.logger("AudioContext was suspended during recording");
            });

            document.addEventListener(
                "visibilitychange",
                handleVisibilityChange,
            );

            currentSession.value = await audioStorage.createSession(
                `${t("audio-recorder.audio.newRecording", { date: new Date().toLocaleString() })}`,
                pcmRecorder.sampleRate,
                1,
            );

            opt.onRecordingStarted(pcmRecorder.stream);

            isRecording.value = true;

            startTime();

            let debugCounter = 0;
            let startUsage = 0;

            if (import.meta.env.DEV) {
                navigator.storage.estimate().then((estimate) => {
                    if (!estimate.usage) {
                        return;
                    }
                    startUsage = estimate.usage / (1024 * 1024);
                });
            }

            const sampleRate = pcmRecorder.sampleRate;

            pcmRecorder.onPCMData(async (pcmData: Float32Array) => {
                pcmArrays.push(pcmData);
                totalSamples += pcmData.length;

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

            try {
                if (currentSession.value) {
                    await audioStorage.deleteSession(currentSession.value);
                    currentSession.value = undefined;
                }
            } catch (err) {
                console.error(
                    "Error cleaning up session after failed start:",
                    err,
                );
            }

            await abortRecording();
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

        opt.onStore(mp3Blob);

        if (opt.disableDefaultStore) {
            return;
        }

        await audioStorage
            .storeAudioChunk(
                currentSession.value as string,
                await mp3Blob.arrayBuffer(),
            )
            .catch((e) => {
                console.error("Error storing audio chunk:", e);
            });
    }

    async function stopRecording(): Promise<void> {
        isRecording.value = false;
        isProcessing.value = true;
        await appendMp3();
        await abortRecording();

        if (!currentSession.value) {
            throw new Error("No active session for recording");
        }

        const session = await audioStorage.getSession(currentSession.value);
        if (!session) {
            throw new Error(
                `Session with ID ${currentSession.value} not found`,
            );
        }

        const buffers = await audioStorage.getSessionChunks(
            currentSession.value,
        );
        const mp3Blob = await concatMp3(buffers);

        audioBlob.value = mp3Blob;
        audioUrl.value = URL.createObjectURL(mp3Blob);

        // Update state with processed audio
        await audioStorage.deleteSession(currentSession.value);
        opt.onRecordingStopped(audioBlob.value, audioUrl.value);

        isProcessing.value = false;
    }

    async function abortRecording(): Promise<void> {
        document.removeEventListener(
            "visibilitychange",
            handleVisibilityChange,
        );

        if (!pcmRecorder) {
            console.error("pcmRecorder is not initialized");
            return;
        }

        try {
            isRecording.value = false;

            await pcmRecorder.stop();

            pcmRecorder = undefined;

            stopTime();
        } catch (e) {
            console.error("Error aborting recording:", e);
        }
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
        wasSuspended,
    };
}
