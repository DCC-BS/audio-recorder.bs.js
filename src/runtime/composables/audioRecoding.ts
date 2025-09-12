import { AudioStorageService } from "../services/audioStorage";
import {
    checkMicrophoneAvailability,
    handleMicrophoneError,
} from "../utils/microphone";
import { useFFmpeg } from "./audioConversion";

export type Options = {
    onRecordingStarted: (stream: MediaStream) => void;
};

export function useAudioRecording(options: Options) {
    const { convertWebmToMp3, combineMp3Blobs } = useFFmpeg();

    const audioStorage = new AudioStorageService();

    const isLoading = ref(false);
    const isRecording = ref(false);
    const mediaRecorder = ref<MediaRecorder>();

    const recordingStartTime = ref(0);
    const recordingTime = ref(0);
    const elapsedTime = ref(0);

    const recordingInterval = ref<NodeJS.Timeout>();
    const requestDataInterval = ref<NodeJS.Timeout>();
    const currentSession = ref<string>();

    const audioBlob = ref<Blob>();
    const audioUrl = ref<string>();

    const error = ref<string>();

    let waitForAudioStoragePromise: Promise<void> | undefined;

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
            options.onRecordingStarted(stream);

            // Update UI state
            isLoading.value = false;
            isRecording.value = true;

            // Create a new MediaRecorder instance
            mediaRecorder.value = new MediaRecorder(stream, {
                mimeType: "audio/webm",
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
            mediaRecorder.value.start();
            recordingStartTime.value = Date.now();
            recordingTime.value = 0;

            // Start the timer to display recording duration
            recordingInterval.value = setInterval(() => {
                recordingTime.value = Math.floor(
                    (Date.now() - recordingStartTime.value) / 1000 +
                        elapsedTime.value,
                );
            }, 1000);

            requestDataInterval.value = setInterval(() => {
                if (mediaRecorder.value && isRecording.value) {
                    mediaRecorder.value.requestData();
                }
            }, 30000);
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
            let reject: (reason?: any) => void = () => {};

            waitForAudioStoragePromise = new Promise((res, rej) => {
                resolve = res;
                reject = rej;
            });

            try {
                if (!currentSession.value) {
                    throw new Error("No active session for recording");
                }

                const webmBlob = new Blob([event.data], {
                    type: "audio/webm",
                });

                const mp3Blob = await convertWebmToMp3(webmBlob, "part");

                await audioStorage.storeAudioBlob(
                    currentSession.value,
                    mp3Blob,
                );

                /**
                 * From my calculations:
                 * 0.4652631579 MB per minute
                 * 27.91578947 MB per hour
                 * on Firefox there is a maximum of 10240 MB storage per origin
                 * => approx 366 hours of recordings
                 */
                navigator.storage.estimate().then((estimate) => {
                    if (!estimate.quota || !estimate.usage) return;

                    const usageMB = (estimate.usage / (1024 * 1024)).toFixed(2);
                    const quotaMB = (estimate.quota / (1024 * 1024)).toFixed(2);
                    console.debug(`Using ${usageMB} MB out of ${quotaMB} MB.`);
                });
            } catch (e) {
                reject(e);
            } finally {
                resolve();
            }
        }
    }

    async function handleStopRecording(stream: MediaStream): Promise<void> {
        await waitForAudioStoragePromise;

        if (!currentSession.value) {
            throw new Error("No active session for recording");
        }

        // Convert webm to mp3 format
        // const mp3Blob = await convertWebmToMp3(webmBlob, "recording");
        const blobs = await audioStorage.getSessionBlobs(currentSession.value);

        console.log("Combining blobs:", blobs.length);

        const combinedBlob = await combineMp3Blobs(blobs);

        // Update state with processed audio
        audioBlob.value = combinedBlob;
        audioUrl.value = URL.createObjectURL(combinedBlob);

        // Release microphone
        for (const track of stream.getTracks()) {
            track.stop();
        }

        // Clear recording timer
        if (recordingInterval.value) {
            clearInterval(recordingInterval.value);
            recordingInterval.value = undefined;
        }

        if (requestDataInterval.value) {
            clearInterval(requestDataInterval.value);
            requestDataInterval.value = undefined;
        }

        audioStorage.deleteSession(currentSession.value);
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
    };
}
