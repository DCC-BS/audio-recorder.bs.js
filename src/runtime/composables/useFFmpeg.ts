import { FFmpeg, type LogEvent } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

function toBlob(data: Uint8Array | string, mimeType: string): Blob {
    if (typeof data === "string") {
        throw new Error("Failed to convert audio: data is a string");
    }

    const arrBuf = data instanceof ArrayBuffer ? data : data.slice(0);
    const uint8 = new Uint8Array(arrBuf);
    return new Blob([uint8], { type: mimeType });
}

function mimeTypeToFileExtension(mime: string) {
    if (mime.includes("audio/mp4")) {
        return "m4a";
    }

    if (mime.includes("audio/webm")) {
        return "webm";
    }

    if (mime.includes("video/mp4")) {
        return "mp4";
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

    async function convertAudioToMp3(
        inputBlob: Blob,
        fileName: string,
    ): Promise<Blob> {
        await ffmpeg.load();

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

    /**
     * Convert 16‑bit PCM Float32Array to MP3 Blob
     */
    async function pcmToMp3(
        pcmFloat32: Float32Array,
        sampleRate: number,
        numChannels: number,
    ): Promise<Blob> {
        // Load FFmpeg wasm
        await ffmpeg.load();

        try {
            // Write raw PCM to FFmpeg virtual FS
            await ffmpeg.writeFile(
                "input.pcm",
                new Uint8Array(pcmFloat32.buffer),
            );

            // Run conversion
            await ffmpeg.exec([
                "-f",
                "f32le",
                "-ar",
                sampleRate.toString(),
                "-ac",
                numChannels.toString(),
                "-i",
                "input.pcm",
                "-codec:a",
                "libmp3lame",
                "-b:a",
                "64k", // bitrate (optional)
                "-ar",
                "16000", // output sample rate (optional)
                "output.mp3",
            ]);

            // Read result
            const data = await ffmpeg.readFile("output.mp3");

            return toBlob(data, "audio/mp3");
        } finally {
            // Clean up
            try {
                await ffmpeg.deleteFile("input.pcm");
            } catch {}
            try {
                await ffmpeg.deleteFile("output.mp3");
            } catch {}
        }
    }

    /**
     * Concatenate multiple MP3 blobs into a single MP3 blob
     */
    async function concatMp3(mp3Buffers: ArrayBuffer[]): Promise<Blob> {
        if (mp3Buffers.length === 0) {
            throw new Error("No MP3 blobs provided");
        }

        const firstBlob = mp3Buffers[0];
        if (mp3Buffers.length === 1 && firstBlob) {
            return new Blob([firstBlob], { type: "audio/mp3" });
        }

        await ffmpeg.load();

        const inputFiles: string[] = [];
        let fileListContent = "";

        try {
            // Write all input MP3 files to FFmpeg virtual FS
            for (let i = 0; i < mp3Buffers.length; i++) {
                const fileName = `input${i}.mp3`;
                inputFiles.push(fileName);

                const buffer = mp3Buffers[i];
                if (!buffer) {
                    continue;
                }

                await ffmpeg.writeFile(fileName, new Uint8Array(buffer));
                fileListContent += `file '${fileName}'\n`;
            }

            // Create concat list file
            await ffmpeg.writeFile(
                "files.txt",
                new TextEncoder().encode(fileListContent),
            );

            // Run FFmpeg concat demuxer with re-encoding to ensure proper MP3 headers
            await ffmpeg.exec([
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                "files.txt",
                "-codec:a",
                "libmp3lame",
                "-write_xing",
                "1",
                "output.mp3",
            ]);

            // Read result
            const data = await ffmpeg.readFile("output.mp3");
            return toBlob(data, "audio/mp3");
        } finally {
            // Clean up all files
            for (const fileName of inputFiles) {
                try {
                    await ffmpeg.deleteFile(fileName);
                } catch {}
            }
            try {
                await ffmpeg.deleteFile("files.txt");
            } catch {}
            try {
                await ffmpeg.deleteFile("output.mp3");
            } catch {}
        }
    }

    return {
        convertAudioToMp3,
        pcmToMp3,
        concatMp3,
    };
}
