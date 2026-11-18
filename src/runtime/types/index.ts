import type { AudioSession } from "../services/db";

export interface CustomAction {
    label: string;
    icon?: string;
    color?: string;
    variant?: string;
    loading?: boolean;
    disabled?: boolean;
    /**
     * Whether the handler needs the joined MP3 (default: true). Joining
     * takes a while; an action that only needs the session id, such as
     * continuing the recording, should set this to false and gets an
     * empty Blob.
     */
    needsAudio?: boolean;
    /** Show the action only for some sessions, e.g. by `status`. */
    visible?: (session: AudioSession) => boolean;
    handler: (
        sessionId: string,
        mp3Blob: Blob,
        deleteSession: () => Promise<void>,
    ) => void | Promise<void>;
}

export interface AudioSessionExplorerProps {
    showDownloadButton?: boolean;
    showDeleteButton?: boolean;
    customActions?: CustomAction[];
}
