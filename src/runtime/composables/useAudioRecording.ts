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
 * @property getStream - Supplies the stream to record instead of the microphone, e.g. a mix of microphone and screen audio. Called on every start; the stream's tracks are not stopped by the recorder, the caller owns them
 */
export type RecordingOptions = {
    onRecordingStarted?: (stream: MediaStream) => void;
    onRecordingStopped?: (audioBlob: Blob, audioUrl: string) => void;
    onError?: (error: string) => void;
    storeToDbInterval?: number;
    onStore?: (mp3Blob: Blob) => void | Promise<void>;
    logger?: (msg: string) => void;
    disableDefaultStore?: boolean;
    getStream?: () => Promise<MediaStream>;
};

const optionsDefault: Required<Omit<RecordingOptions, "getStream">> = {
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
    /** Between the start request and the first sample: devices, permission prompt, session. */
    const isStarting = ref(false);
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

    // once the owner is gone a finished recording can no longer be handed
    // over, so it must stay in storage as an abandoned recording
    let disposed = false;

    onUnmounted(() => {
        disposed = true;
        document.removeEventListener(
            "visibilitychange",
            handleVisibilityChange,
        );
        if (pcmRecorder) {
            // keep what was recorded since the last store, so the session
            // shows up complete among the abandoned recordings
            if (isRecording.value) {
                appendMp3().catch(() => {});
            }
            abortRecording();
        }
    });

    /**
     * Reports a failure through `error` and the onError callback.
     *
     * @param message - What went wrong.
     */
    function fail(message: string): void {
        error.value = message;
        opt.onError(message);
    }

    async function startRecording() {
        // a recording still starting or being joined owns the session and
        // the buffers; a second start would record twice into them
        if (isRecording.value || isStarting.value || isProcessing.value) {
            return;
        }

        isStarting.value = true;
        try {
            await start();
        } finally {
            isStarting.value = false;
        }
    }

    async function start() {
        // a supplied stream need not involve a microphone at all
        if (!opt.getStream) {
            const availabilityResult = await checkMicrophoneAvailability();
            if (!availabilityResult.isAvailable) {
                fail(availabilityResult.message || "Microphone not available");
                return;
            }
        }

        resetRecording();

        try {
            const externalStream = opt.getStream
                ? await opt.getStream()
                : undefined;
            pcmRecorder = await startPcmRecorder(externalStream);

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
                // samples still arrive until the recorder is torn down; they
                // come after the end the user chose and are dropped
                if (!isRecording.value) {
                    return;
                }

                pcmArrays.push(pcmData);
                totalSamples += pcmData.length;

                const durationInSeconds = totalSamples / sampleRate;

                if (durationInSeconds >= opt.storeToDbInterval) {
                    // nobody awaits this listener, so failures end here
                    appendMp3().catch((e) => {
                        opt.logger(`Storing an audio chunk failed: ${e}`);
                    });
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
            // getStream errors are the caller's (e.g. a cancelled screen
            // picker) and must not be reported as microphone problems
            fail(
                opt.getStream
                    ? (e as Error)?.message || "Recording could not be started"
                    : handleMicrophoneError(e as Error),
            );

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

            if (pcmRecorder) {
                await abortRecording();
            }
        }
    }

    let appendQueue: Promise<void> = Promise.resolve();

    /**
     * Encodes the buffered samples and stores them as the next chunk.
     *
     * The samples, session and sample rate are taken right away; only the
     * encoding waits its turn. Chunks are therefore stored in recording
     * order, the call made by stopRecording settles after every earlier
     * one, and a queued call never depends on a recorder that has been torn
     * down in the meantime.
     *
     * @returns Settles once this chunk (and every earlier one) is stored.
     */
    function appendMp3(): Promise<void> {
        // stopping right after a periodic store leaves nothing to encode,
        // and FFmpeg fails on empty input
        if (!pcmRecorder || pcmArrays.length === 0) {
            return appendQueue;
        }

        const data = toPcmData(pcmArrays);
        const sampleRate = pcmRecorder.sampleRate;
        const sessionId = currentSession.value as string;
        totalSamples = 0;
        pcmArrays = [];

        const next = appendQueue.then(() =>
            storeChunk(data, sampleRate, sessionId),
        );
        appendQueue = next.catch(() => {});
        return next;
    }

    async function storeChunk(
        data: Float32Array,
        sampleRate: number,
        sessionId: string,
    ): Promise<void> {
        const mp3Blob = await pcmToMp3(data, sampleRate, 1);

        await opt.onStore(mp3Blob);

        if (opt.disableDefaultStore) {
            return;
        }

        await audioStorage
            .storeAudioChunk(sessionId, await mp3Blob.arrayBuffer())
            .catch((e) => {
                console.error("Error storing audio chunk:", e);
            });
    }

    async function stopRecording(): Promise<void> {
        isRecording.value = false;
        isProcessing.value = true;

        // a failure must not leave isProcessing set: callers gate new
        // recordings on it
        try {
            // appendMp3 takes the samples right away, so the devices are
            // released even when encoding that last chunk fails
            const stored = appendMp3();
            await abortRecording();
            await stored;

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
            // stopped before any audio arrived: nothing worth keeping
            if (buffers.length === 0) {
                await audioStorage.deleteSession(currentSession.value);
                throw new Error("Nothing was recorded");
            }
            const mp3Blob = await concatMp3(buffers);

            // nobody is left to receive it: keep it recoverable instead
            if (disposed) {
                return;
            }

            audioBlob.value = mp3Blob;
            audioUrl.value = URL.createObjectURL(mp3Blob);

            // Update state with processed audio
            await audioStorage.deleteSession(currentSession.value);
            opt.onRecordingStopped(audioBlob.value, audioUrl.value);
        } catch (e) {
            fail((e as Error)?.message || "Recording could not be finished");
            throw e;
        } finally {
            isProcessing.value = false;
        }
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
        isStarting,
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
