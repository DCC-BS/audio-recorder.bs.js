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

    /*
        Every operation works on fixed file names in one shared virtual FS,
        so two running at once (a periodic chunk still encoding when the
        recording stops) overwrite each other's files and fail. Queue them.
    */
    let queue: Promise<unknown> = Promise.resolve();

    /**
     * Runs an FFmpeg operation once all earlier ones have finished.
     *
     * @param operation - The operation to run.
     * @returns The operation's result.
     */
    function exclusive<T>(operation: () => Promise<T>): Promise<T> {
        const result = queue.then(operation, operation);
        queue = result.catch(() => {});
        return result;
    }

    if (logger) {
        ffmpeg.on("log", ({ message: msg }: LogEvent) => {
            logger(msg);
        });
    }

    function convertAudioToMp3(inputBlob: Blob, fileName: string) {
        return exclusive(() => convertAudioToMp3Now(inputBlob, fileName));
    }

    async function convertAudioToMp3Now(
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
    function pcmToMp3(
        pcmFloat32: Float32Array,
        sampleRate: number,
        numChannels: number,
    ) {
        return exclusive(() =>
            pcmToMp3Now(pcmFloat32, sampleRate, numChannels),
        );
    }

    async function pcmToMp3Now(
        pcmFloat32: Float32Array,
        sampleRate: number,
        numChannels: number,
    ): Promise<Blob> {
        // Load FFmpeg wasm
        await ffmpeg.load();

        try {
            // Write raw PCM to FFmpeg virtual FS
            const pcmBytes = new Uint8Array(
                pcmFloat32.buffer,
                pcmFloat32.byteOffset,
                pcmFloat32.byteLength,
            );
            await ffmpeg.writeFile("input.pcm", pcmBytes);

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
    function concatMp3(mp3Buffers: ArrayBuffer[]) {
        return exclusive(() => concatMp3Now(mp3Buffers));
    }

    async function concatMp3Now(mp3Buffers: ArrayBuffer[]): Promise<Blob> {
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
