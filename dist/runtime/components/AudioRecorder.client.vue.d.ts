interface Props {
    showResult?: boolean;
    autoStart?: boolean;
    logger?: (msg: string) => void;
}
declare const __VLS_export: import("vue").DefineComponent<Props, {}, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {} & {
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
