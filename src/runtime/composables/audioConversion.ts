import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

function toBlob(data: Uint8Array | string, mimeType: string): Blob {
    if (typeof data === "string") {
        throw new Error("Failed to convert audio: data is a string");
    }

    const arrBuf = data instanceof ArrayBuffer ? data : data.slice(0);
    const uint8 = new Uint8Array(arrBuf);
    return new Blob([uint8], { type: mimeType });
}

export function useFFmpeg() {
    const ffmpeg = new FFmpeg();

    // use this for debugging errors with ffmpeg
    // ffmpeg.on("log", ({ message: msg }: LogEvent) => {
    //     console.log(msg);
    // });

    const loadPromise = ffmpeg.load();

    async function convertWebmToMp3(
        webmBlob: Blob,
        fileName: string,
    ): Promise<Blob> {
        await loadPromise;

        const webmFileName = `${fileName}.webm`;
        const mp3FileName = `${fileName}.mp3`;

        try {
            await ffmpeg.writeFile(webmFileName, await fetchFile(webmBlob));
            await ffmpeg.exec(["-i", webmFileName, mp3FileName]);
            const data = await ffmpeg.readFile(mp3FileName);
            return toBlob(data, "audio/mp3");
        } finally {
            await ffmpeg.deleteFile(webmFileName);
            await ffmpeg.deleteFile(mp3FileName);
        }
    }

    return {
        convertWebmToMp3,
    };
}
