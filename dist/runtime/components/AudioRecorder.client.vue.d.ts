interface Props {
    showResult?: boolean;
}
declare const _default: import("vue").DefineComponent<Props, {}, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {} & {
    "recording-started": (stream: MediaStream) => any;
    "recording-stopped": (audioBlob: Blob, audioUrl: string) => any;
}, string, import("vue").PublicProps, Readonly<Props> & Readonly<{
    "onRecording-started"?: ((stream: MediaStream) => any) | undefined;
    "onRecording-stopped"?: ((audioBlob: Blob, audioUrl: string) => any) | undefined;
}>, {
    showResult: boolean;
}, {}, {}, {}, string, import("vue").ComponentProvideOptions, false, {}, any>;
export default _default;
