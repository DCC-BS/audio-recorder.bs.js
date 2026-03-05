import PCMAudioWorkletUrl from "../assets/pcm-recorder-worklet.js?url";
import { KeepAwake } from "./keepAwake";

export class PCMRecorder {
    listeners: Array<(data: Float32Array) => void> = [];
    private keepAwake: KeepAwake;
    private _onContextSuspended?: () => void;
    private _logger: (msg: string) => void;
    private _wasSuspended = false;

    constructor(
        public readonly stream: MediaStream,
        public readonly audioContext: AudioContext,
        public readonly pcmWorklet: AudioWorkletNode,
        public readonly source: MediaStreamAudioSourceNode,
        public readonly sampleRate: number = audioContext.sampleRate,
    ) {
        this._logger = () => {};
        this.keepAwake = new KeepAwake(this._logger);

        this.audioContext.addEventListener(
            "statechange",
            this.handleStateChange.bind(this),
        );

        pcmWorklet.port.onmessage = async (event) => {
            try {
                if (event.data.type === "data") {
                    const samples = event.data.samples as Float32Array;
                    for (const listener of this.listeners) {
                        listener(samples);
                    }
                }
            } catch (e) {
                console.error("Error processing PCM data:", e);
            }
        };
    }

    setLogger(logger: (msg: string) => void): void {
        this._logger = logger;
        this.keepAwake = new KeepAwake(logger);
    }

    setOnContextSuspended(callback: () => void): void {
        this._onContextSuspended = callback;
    }

    get wasSuspended(): boolean {
        return this._wasSuspended;
    }

    private handleStateChange(): void {
        if (this.audioContext.state === "suspended") {
            this._logger("AudioContext was suspended");
            this._wasSuspended = true;
            this._onContextSuspended?.();
            this.audioContext.resume().catch((e) => {
                this._logger(`Failed to resume AudioContext: ${e}`);
            });
        }
    }

    public onPCMData(listener: (data: Float32Array) => void) {
        this.listeners.push(listener);
    }

    public async startKeepAwake(): Promise<void> {
        await this.keepAwake.start();
    }

    public stopKeepAwake(): void {
        this.keepAwake.stop();
    }

    public async handleVisibilityChange(): Promise<void> {
        await this.keepAwake.handleVisibilityChange();

        if (
            document.visibilityState === "visible" &&
            this.audioContext.state === "suspended"
        ) {
            this._logger("Resuming AudioContext after visibility change");
            await this.audioContext.resume();
        }
    }

    public async stop() {
        this.keepAwake.stop();

        this.audioContext.removeEventListener(
            "statechange",
            this.handleStateChange.bind(this),
        );

        for (const track of this.stream.getTracks()) {
            track.stop();
        }

        this.pcmWorklet.port.postMessage({ type: "stop" });
        this.pcmWorklet.port.onmessage = null;
        this.pcmWorklet.port.close();
        this.pcmWorklet.disconnect();

        this.source.disconnect();

        await this.audioContext.close();
    }
}

export async function startPcmRecorder() {
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
    });

    const audioContext = new AudioContext();

    await audioContext.audioWorklet.addModule(PCMAudioWorkletUrl);
    const source = audioContext.createMediaStreamSource(stream);

    const pcmWorklet = new AudioWorkletNode(audioContext, "pcm-recorder", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
    });

    source.connect(pcmWorklet);
    pcmWorklet.connect(audioContext.destination);

    if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: "Active Recording",
            artist: "Transcribo",
            album: "Transcribo",
        });

        navigator.mediaSession.playbackState = "none";
    }

    const recorder = new PCMRecorder(stream, audioContext, pcmWorklet, source);
    await recorder.startKeepAwake();

    return recorder;
}
