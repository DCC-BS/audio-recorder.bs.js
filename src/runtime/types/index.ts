import type { AudioSession } from "../services/db";

export interface CustomAction {
    label: string;
    icon?: string;
    color?: string;
    variant?: string;
    loading?: boolean;
    disabled?: boolean;
    /** false: skip joining the MP3 (slow); the handler gets an empty Blob. */
    needsAudio?: boolean;
    /** Show the action only for some sessions, e.g. by `status`. */
    visible?: (session: AudioSession) => boolean;
    /**
     * `deleteSession` rejects if the session got new audio since the action
     * started (so it deletes only the audio in `mp3Blob`, or with
     * `needsAudio: false` the session as it was then) or is being recorded.
     * `chunkCount` is the number of chunks in `mp3Blob` (undefined without
     * audio), e.g. for `markAsStopped`.
     */
    handler: (
        sessionId: string,
        mp3Blob: Blob,
        deleteSession: () => Promise<void>,
        chunkCount?: number,
    ) => void | Promise<void>;
}

export interface AudioSessionExplorerProps {
    showDownloadButton?: boolean;
    showDeleteButton?: boolean;
    customActions?: CustomAction[];
}
