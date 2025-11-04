import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
function toBlob(data, mimeType) {
  if (typeof data === "string") {
    throw new Error("Failed to convert audio: data is a string");
  }
  const arrBuf = data instanceof ArrayBuffer ? data : data.slice(0);
  const uint8 = new Uint8Array(arrBuf);
  return new Blob([uint8], { type: mimeType });
}
export function useFFmpeg(logger) {
  const ffmpeg = new FFmpeg();
  if (logger) {
    ffmpeg.on("log", ({ message: msg }) => {
      logger(msg);
    });
  }
  const loadPromise = ffmpeg.load();
  async function convertWebmToMp3(webmBlob, fileName) {
    await loadPromise;
    const webmFileName = `${fileName}.webm`;
    const mp3FileName = `${fileName}.mp3`;
    try {
      await ffmpeg.writeFile(webmFileName, await fetchFile(webmBlob));
      await ffmpeg.exec(["-i", webmFileName, mp3FileName]);
      const data = await ffmpeg.readFile(mp3FileName);
      return toBlob(data, "audio/mp3");
    } finally {
      try {
        await ffmpeg.deleteFile(webmFileName);
      } catch {
      }
      try {
        await ffmpeg.deleteFile(mp3FileName);
      } catch {
      }
    }
  }
  return {
    convertWebmToMp3
  };
}
