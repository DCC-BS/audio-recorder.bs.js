interface Props {
    showResult?: boolean;
    autoStart?: boolean;
    logger?: (msg: string) => void;
}
declare const __VLS_export: import("vue").DefineComponent<Props, {
    isRecording: import("vue").Ref<boolean, boolean>;
    startRecording: () => Promise<void>;
    stopRecording: () => void;
    recordingTime: import("vue").Ref<number, number>;
    formattedRecordingTime: import("vue").ComputedRef<string>;
    error: import("vue").Ref<string | undefined, string | undefined>;
    audioUrl: import("vue").Ref<string | undefined, string | undefined>;
}, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {} & {
    "recording-started": (stream: MediaStream) => any;
    "recording-stopped": (audioBlob: Blob, audioUrl: string) => any;
}, string, import("vue").PublicProps, Readonly<Props> & Readonly<{
    "onRecording-started"?: ((stream: MediaStream) => any) | undefined;
    "onRecording-stopped"?: ((audioBlob: Blob, audioUrl: string) => any) | undefined;
}>, {
    logger: (msg: string) => void;
    showResult: boolean;
    autoStart: boolean;
}, {}, {}, {}, string, import("vue").ComponentProvideOptions, false, {}, any>;
declare const _default: typeof __VLS_export;
export default _default;
