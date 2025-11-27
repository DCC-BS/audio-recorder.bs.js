import { onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import PCMAudioWorkletUrl from "../assets/pcm-recorder-worklet.js?url";
import { AudioStorageService } from "../services/audioStorage";
import {
    checkMicrophoneAvailability,
    handleMicrophoneError,
} from "../utils/microphone";
import { useFFmpeg } from "./audioConversion";
import { useRecordingTime } from "./useRecodingTime";

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
    onRecordingStarted: () => {},
    onRecordingStopped: () => {},
    onError: () => {},
    storeToDbInterval: 30000, // 30000
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
    const isLoading = ref(false);
    const isRecording = ref(false);
    const isProcessing = ref(false);
    const audioStorage = new AudioStorageService();

    const { startTime, stopTime, recordingTime } = useRecordingTime();

    const currentSession = ref<string>();

    let stream: MediaStream | undefined;
    let audioContext: AudioContext | undefined;
    let pcmWorklet: AudioWorkletNode | undefined;
    let source: MediaStreamAudioSourceNode | undefined;

    const error = ref<string>();
    const audioBlob = ref<Blob>();
    const audioUrl = ref<string>();

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

        resetRecording();

        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
            });

            audioContext = new AudioContext({
                sampleRate: 48000, // or let the browser choose
            });

            await audioContext.audioWorklet.addModule(PCMAudioWorkletUrl);
            source = audioContext.createMediaStreamSource(stream);

            pcmWorklet = new AudioWorkletNode(audioContext, "pcm-recorder", {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                channelCount: 1,
            });

            source.connect(pcmWorklet);
            pcmWorklet.connect(audioContext.destination); // or audioContext.createGain() if you don’t want local playback

            currentSession.value = await audioStorage.createSession(
                `${t("audio-recorder.audio.newRecording", { date: new Date().toLocaleString() })}`,
                audioContext.sampleRate,
                1,
            );

            // Initialize visualization
            opt.onRecordingStarted(stream);

            // Update UI state
            isLoading.value = false;
            isRecording.value = true;

            // Setup for iOS background audio
            if ("mediaSession" in navigator) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: "Active Recording",
                    artist: "Transcribo",
                    album: "Transcribo",
                });

                navigator.mediaSession.playbackState = "none";
            }

            startTime();

            // Receive raw PCM frames from the worklet
            pcmWorklet.port.onmessage = async (event) => {
                if (event.data.type === "data") {
                    audioStorage
                        .storeAudioChunk(
                            currentSession.value as string,
                            event.data.samples as Float32Array,
                        )
                        .catch((e) => {
                            console.error("Error storing audio chunk:", e);
                        });

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
                }
            };
        } catch (e) {
            console.error(e);
            error.value = handleMicrophoneError(e as Error);
        }
    }

    async function stopRecording(): Promise<void> {
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
        const pcmData = await audioStorage.getPcmData(currentSession.value);

        const { pcmToMp3 } = useFFmpeg(opt.logger);
        const mp3Blob = await pcmToMp3(
            pcmData,
            session.sampleRate,
            session.numChannels,
        );

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
        if (!source || !pcmWorklet || !stream || !audioContext) {
            console.error(
                "source, pcmWorklet, stream, audioContext",
                source,
                pcmWorklet,
                stream,
                audioContext,
            );

            throw new Error("invalid state");
        }

        isRecording.value = false;
        source.disconnect();
        pcmWorklet.disconnect();

        for (const track of stream.getTracks()) {
            track.stop();
        }
        await audioContext.close();
        // Clear recording timer
        stopTime();
    }

    function resetRecording(): void {
        audioBlob.value = undefined;
        audioUrl.value = "";
        error.value = "";
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
