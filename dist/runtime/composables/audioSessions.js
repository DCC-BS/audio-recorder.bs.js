import { onMounted, ref } from "vue";
import { AudioStorageService } from "../services/audioStorage.js";
import { useFFmpeg } from "./audioConversion.js";
const optionsDefault = {
  deleteOldSessionsDaysInterval: 7,
  maxSessionsToKeep: 10,
  logger: (_) => {
  }
};
export async function getAbandonedRecording() {
  const audioStorage = new AudioStorageService();
  return audioStorage.getAllSessions();
}
export function useAudioSessions(options = {}) {
  const opt = { ...optionsDefault, ...options };
  const isReady = ref(false);
  const audioStorage = new AudioStorageService();
  const abandonedRecording = ref(void 0);
  const { convertWebmToMp3 } = useFFmpeg(opt.logger);
  onMounted(async () => {
    await audioStorage.clearSessionsOlderThan(
      opt.deleteOldSessionsDaysInterval
    );
    await audioStorage.clearSessionOverThreshold(opt.maxSessionsToKeep);
    abandonedRecording.value = await audioStorage.getAllSessions();
    isReady.value = true;
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
    if (abandonedRecording.value) {
      abandonedRecording.value = abandonedRecording.value.filter(
        (s) => s.id !== sessionId
      );
    }
  }
  return {
    isReady,
    abandonedRecording,
    getWebmBlob,
    getMp3Blob,
    deleteAbandonedRecording
  };
}
