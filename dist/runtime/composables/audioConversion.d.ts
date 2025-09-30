/**
 * Hook to use FFmpeg for audio conversion
 */
export declare function useFFmpeg(logger?: (msg: string) => void): {
    convertWebmToMp3: (webmBlob: Blob, fileName: string) => Promise<Blob>;
};
