import { onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import PCMAudioWorkletUrl from "../assets/pcm-recorder-worklet.js?url";
import { AudioStorageService } from "../services/audioStorage";
import {
    checkMicrophoneAvailability,
    handleMicrophoneError,
} from "../utils/microphone";
import { toPcmData } from "../utils/pcm";
import { useFFmpeg } from "./useFFmpeg";
import { useRecordingTime } from "./useRecodingTime";

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

    let stream: MediaStream | undefined;
    let audioContext: AudioContext | undefined;
    let pcmWorklet: AudioWorkletNode | undefined;
    let source: MediaStreamAudioSourceNode | undefined;

    let pcmArrays: Float32Array[] = [];
    let totalSamples = 0;

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

            audioContext = new AudioContext();
            const sampleRate = audioContext.sampleRate;

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

            let debugCounter = 0;
            let startUsage = 0;

            navigator.storage.estimate().then((estimate) => {
                if (!estimate.usage) {
                    return;
                }
                startUsage = estimate.usage / (1024 * 1024);
            });

            // Receive raw PCM frames from the worklet
            pcmWorklet.port.onmessage = async (event) => {
                try {
                    if (event.data.type === "data") {
                        const samples = event.data.samples as Float32Array;
                        pcmArrays.push(samples);
                        totalSamples += samples.length;

                        // Calculate total duration of accumulated PCM data
                        const durationInSeconds = totalSamples / sampleRate;

                        if (durationInSeconds >= opt.storeToDbInterval) {
                            totalSamples = 0;
                            console.log(
                                "Appending MP3 chunk, duration:",
                                durationInSeconds.toFixed(2),
                                "seconds",
                            );
                            await appendMp3();
                            console.log(
                                "Appended MP3 chunk, clearing PCM arrays",
                            );
                        }

                        // audioStorage
                        //     .storeAudioChunk(
                        //         currentSession.value as string,
                        //         event.data.samples as Float32Array,
                        //     )
                        //     .catch((e) => {
                        //         console.error("Error storing audio chunk:", e);
                        //     });

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
                    }
                } catch (e) {
                    console.error("Error processing PCM data:", e);
                }
            };
        } catch (e) {
            console.error(e);
            error.value = handleMicrophoneError(e as Error);
        }
    }

    async function appendMp3() {
        if (!audioContext) {
            throw new Error("AudioContext is not initialized");
        }

        const data = toPcmData(pcmArrays);
        totalSamples = 0;
        pcmArrays = [];

        const mp3Blob = await pcmToMp3(data, audioContext.sampleRate, 1);

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
        if (!source || !pcmWorklet || !stream || !audioContext) {
            console.error(
                "source, pcmworklet, stream, audioContext",
                source,
                pcmWorklet,
                stream,
                audioContext,
            );

            throw new Error("invalid state");
        }

        isRecording.value = false;

        // Stop the worklet message port
        pcmWorklet.port.onmessage = null;
        pcmWorklet.port.close();

        // Disconnect audio nodes
        source.disconnect();
        pcmWorklet.disconnect();

        // Stop all media tracks
        for (const track of stream.getTracks()) {
            track.stop();
        }

        // Close the audio context (this will unload the worklet module)
        await audioContext.close();

        // Clear references
        source = undefined;
        pcmWorklet = undefined;
        stream = undefined;
        audioContext = undefined;

        // Clear recording timer
        stopTime();
    }

    function resetRecording(): void {
        audioBlob.value = undefined;
        audioUrl.value = "";
        error.value = "";
        pcmArrays = [];
        totalSamples = 0;
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
