import { onMounted, onUnmounted, ref } from "vue";
import { AudioStorageService } from "../services/audioStorage.js";
import {
  checkMicrophoneAvailability,
  handleMicrophoneError
} from "../utils/microphone.js";
import { useFFmpeg } from "./audioConversion.js";
const optionsDefault = {
  onRecordingStarted: () => {
  },
  onRecordingStopped: () => {
  },
  onError: () => {
  },
  storeToDbInterval: 3e4,
  // 30000
  mimeType: "audio/webm;codecs=opus",
  deleteOldSessionsDaysInterval: 7,
  logger: (_) => {
  }
};
export function useAudioRecording(options = {}) {
  const opt = { ...optionsDefault, ...options };
  const { convertWebmToMp3 } = useFFmpeg(opt.logger);
  const audioStorage = new AudioStorageService();
  const isLoading = ref(false);
  const isRecording = ref(false);
  const mediaRecorder = ref();
  const recordingStartTime = ref(0);
  const recordingTime = ref(0);
  const elapsedTime = ref(0);
  const recordingInterval = ref();
  const currentSession = ref();
  const audioBlob = ref();
  const audioUrl = ref();
  const error = ref();
  const abandonedRecording = ref([]);
  let waitForAudioStoragePromise;
  onMounted(async () => {
    await audioStorage.clearSessionsOlderThan(
      opt.deleteOldSessionsDaysInterval
    );
    abandonedRecording.value = await audioStorage.getAllSessions();
  });
  onUnmounted(() => {
    if (isRecording.value) {
      abortRecording();
    }
  });
  async function getWebmBlob(sessionId) {
    const blobs = await audioStorage.getSessionBlobs(sessionId);
    return new Blob(blobs, { type: "audio/webm" });
  }
  async function getMp3Blob(sessionId) {
    const blobs = await audioStorage.getSessionBlobs(sessionId);
    const webmBlob = new Blob(blobs, { type: "audio/webm" });
    const mp3Blob = await convertWebmToMp3(webmBlob, "recording");
    return mp3Blob;
  }
  async function deleteAbandonedRecording(sessionId) {
    await audioStorage.deleteSession(sessionId);
    abandonedRecording.value = abandonedRecording.value.filter(
      (s) => s.id !== sessionId
    );
  }
  async function startRecording() {
    const availabilityResult = await checkMicrophoneAvailability();
    if (!availabilityResult.isAvailable) {
      error.value = availabilityResult.message || "Microphone not available";
      isLoading.value = false;
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true
      });
      currentSession.value = await audioStorage.createSession(
        `New Recording ${(/* @__PURE__ */ new Date()).toLocaleString()}`
      );
      opt.onRecordingStarted(stream);
      isLoading.value = false;
      isRecording.value = true;
      mediaRecorder.value = new MediaRecorder(stream, {
        mimeType: options.mimeType
      });
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: "Active Recording",
          artist: "Transcribo",
          album: "Transcribo"
        });
      }
      mediaRecorder.value.ondataavailable = handleRecordingDataAvailable;
      mediaRecorder.value.onstop = async () => await handleStopRecording(stream);
      mediaRecorder.value.start(opt.storeToDbInterval);
      recordingStartTime.value = Date.now();
      recordingTime.value = 0;
      recordingInterval.value = setInterval(() => {
        recordingTime.value = Math.floor(
          (Date.now() - recordingStartTime.value) / 1e3 + elapsedTime.value
        );
      }, 1e3);
    } catch (e) {
      error.value = handleMicrophoneError(e);
    }
  }
  function stopRecording() {
    if (mediaRecorder.value && isRecording.value) {
      isRecording.value = false;
      mediaRecorder.value.stop();
    }
  }
  function abortRecording() {
    if (mediaRecorder.value && isRecording.value) {
      isRecording.value = false;
      mediaRecorder.value.onstop = null;
      mediaRecorder.value.stop();
    }
  }
  async function handleRecordingDataAvailable(event) {
    if (event.data.size > 0) {
      let resolve = () => {
      };
      let reject = () => {
      };
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
          event.data
        );
        if (import.meta.env.DEV) {
          navigator.storage.estimate().then((estimate) => {
            if (!estimate.quota || !estimate.usage) return;
            const usageMB = (estimate.usage / (1024 * 1024)).toFixed(2);
            const quotaMB = (estimate.quota / (1024 * 1024)).toFixed(2);
            console.debug(
              `Using ${usageMB} MB out of ${quotaMB} MB.`
            );
          });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        error.value = message;
        opt.onError(message);
        reject(e);
      } finally {
        resolve();
      }
    }
  }
  async function handleStopRecording(stream) {
    try {
      await waitForAudioStoragePromise;
      if (!currentSession.value) {
        throw new Error("No active session for recording");
      }
      const blobs = await audioStorage.getSessionBlobs(
        currentSession.value
      );
      const webmBlob = new Blob(blobs, { type: options.mimeType });
      const mp3Blob = await convertWebmToMp3(webmBlob, "recording");
      audioBlob.value = mp3Blob;
      audioUrl.value = URL.createObjectURL(mp3Blob);
      for (const track of stream.getTracks()) {
        track.stop();
      }
      if (recordingInterval.value) {
        clearInterval(recordingInterval.value);
        recordingInterval.value = void 0;
      }
      audioStorage.deleteSession(currentSession.value);
      opt.onRecordingStopped(audioBlob.value, audioUrl.value);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      error.value = message;
      opt.onError(message);
    }
  }
  function resetRecording() {
    audioBlob.value = void 0;
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
    deleteAbandonedRecording
  };
}
