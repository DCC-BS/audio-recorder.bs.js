import { FFmpeg, type LogEvent } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { mixLinearColor } from "motion-v";

function toBlob(data: Uint8Array | string, mimeType: string): Blob {
    if (typeof data === "string") {
        throw new Error("Failed to convert audio: data is a string");
    }

    const arrBuf = data instanceof ArrayBuffer ? data : data.slice(0);
    const uint8 = new Uint8Array(arrBuf);
    return new Blob([uint8], { type: mimeType });
}

function mimeTypeToFileExtension(mime: string) {
    if(mime.includes("audio/mp4")){
        return "m4a";
    }
    
    if(mime.includes("audio/webm")) {
        return "webm"; 
    }

    if(mime.includes("video/mp4")) {
        return "mp4"
    }

    return "webm";
}

/**
 * Hook to use FFmpeg for audio conversion
 */
export function useFFmpeg(logger?: (msg: string) => void) {
    const ffmpeg = new FFmpeg();

    if (logger) {
        ffmpeg.on("log", ({ message: msg }: LogEvent) => {
            logger(msg);
        });
    }

    const loadPromise = ffmpeg.load();

    async function convertWebmToMp3(
        inputBlob: Blob,
        fileName: string,
    ): Promise<Blob> {
        await loadPromise;

        const ext = mimeTypeToFileExtension(inputBlob.type);

        const inputFileName = `${fileName}.${ext}`;
        const mp3FileName = `${fileName}.mp3`;

        try {
            await ffmpeg.writeFile(inputFileName, await fetchFile(inputBlob));
            await ffmpeg.exec(["-i", inputFileName, mp3FileName]);
            const data = await ffmpeg.readFile(mp3FileName);
            return toBlob(data, "audio/mp3");
        } finally {
            try {
                await ffmpeg.deleteFile(inputFileName);
            } catch {}
            try {
                await ffmpeg.deleteFile(mp3FileName);
            } catch {}
        }
    }

    return {
        convertWebmToMp3,
    };
}
