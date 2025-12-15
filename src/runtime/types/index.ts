export interface CustomAction {
    label: string;
    icon?: string;
    color?: string;
    variant?: string;
    loading?: boolean;
    disabled?: boolean;
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
