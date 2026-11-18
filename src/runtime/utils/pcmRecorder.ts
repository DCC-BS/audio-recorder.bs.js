import PCMAudioWorkletUrl from "../assets/pcm-recorder-worklet.js?url";
import { KeepAwake } from "./keepAwake";

export class PCMRecorder {
    listeners: Array<(data: Float32Array) => void> = [];
    private keepAwake: KeepAwake;
    private _onContextSuspended?: () => void;
    private _onInterrupted?: () => void;
    private _paused = false;
    private _logger: (msg: string) => void;
    private _wasSuspended = false;
    private _boundHandleStateChange: () => void;
    private _boundHandleTrackMute: () => void;
    private readonly _inputTrack: MediaStreamTrack | undefined;
    private _pauseAcknowledged: Promise<void> = Promise.resolve();
    private _acknowledgePause: () => void = () => {};

    constructor(
        public readonly stream: MediaStream,
        public readonly audioContext: AudioContext,
        public readonly pcmWorklet: AudioWorkletNode,
        public readonly source: MediaStreamAudioSourceNode,
        public readonly sampleRate: number = audioContext.sampleRate,
        /** Whether stop() ends the stream's tracks; false for a caller's stream. */
        private readonly ownsStream: boolean = true,
        /** The track `source` was created from; defaults to the first one. */
        inputTrack: MediaStreamTrack | undefined = stream.getAudioTracks()[0],
    ) {
        this._logger = () => {};
        this.keepAwake = new KeepAwake(this._logger);
        this._boundHandleStateChange = this.handleStateChange.bind(this);
        this._boundHandleTrackMute = this.handleTrackMute.bind(this);
        this._inputTrack = inputTrack;

        this.audioContext.addEventListener(
            "statechange",
            this._boundHandleStateChange,
        );

        // WebKit mutes the mic during a call or Siri; a caller's stream may
        // mute for its own reasons, so only our own mic is watched
        if (this.ownsStream) {
            for (const track of this.stream.getAudioTracks()) {
                track.addEventListener("mute", this._boundHandleTrackMute);
            }
        }

        pcmWorklet.port.onmessage = async (event) => {
            try {
                if (event.data.type === "data") {
                    const samples = event.data.samples as Float32Array;
                    for (const listener of this.listeners) {
                        listener(samples);
                    }
                } else if (event.data.type === "paused") {
                    this._acknowledgePause();
                }
            } catch (e) {
                console.error("Error processing PCM data:", e);
            }
        };
    }

    setLogger(logger: (msg: string) => void): void {
        this._logger = logger;
        this.keepAwake.setLogger(logger);
    }

    setOnContextSuspended(callback: () => void): void {
        this._onContextSuspended = callback;
    }

    /** Called when the system takes the audio away (call, Siri). */
    setOnInterrupted(callback: (() => void) | undefined): void {
        this._onInterrupted = callback;
    }

    get wasSuspended(): boolean {
        return this._wasSuspended;
    }

    /** Whether the kept devices can be resumed instead of replaced. */
    get isHealthy(): boolean {
        const track = this._inputTrack;
        return (
            this.audioContext.state !== "closed" &&
            track !== undefined &&
            this.stream.getAudioTracks().includes(track) &&
            track.readyState === "live" &&
            !track.muted
        );
    }

    private handleTrackMute(): void {
        if (this._paused) {
            return;
        }
        this._logger("Microphone track was muted");
        this._onInterrupted?.();
    }

    private handleStateChange(): void {
        if (this._paused) {
            return;
        }

        // WebKit-only state
        if ((this.audioContext.state as string) === "interrupted") {
            this._logger("AudioContext was interrupted");
            if (this._onInterrupted) {
                this._onInterrupted();
                return;
            }
        }

        if (
            this.audioContext.state === "suspended" ||
            (this.audioContext.state as string) === "interrupted"
        ) {
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

    /** Pauses with the devices kept open, so resuming needs no prompt. */
    public pause(): void {
        this._paused = true;
        // the worklet answers "paused" after every block it posted before
        this._pauseAcknowledged = new Promise((resolve) => {
            this._acknowledgePause = resolve;
        });
        this.pcmWorklet.port.postMessage({ type: "pause" });
        this.keepAwake.stop();
    }

    public async resume(): Promise<void> {
        if (this.audioContext.state !== "running") {
            await this.audioContext.resume();
        }
        // no block from before the pause may land after the resume
        await Promise.race([
            this._pauseAcknowledged,
            new Promise((resolve) => setTimeout(resolve, PAUSE_ACK_TIMEOUT_MS)),
        ]);
        this._paused = false;
        this.pcmWorklet.port.postMessage({ type: "resume" });
        await this.keepAwake.start();
    }

    public async handleVisibilityChange(): Promise<void> {
        await this.keepAwake.handleVisibilityChange();

        if (
            !this._paused &&
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
            this._boundHandleStateChange,
        );

        // a stream handed in by the caller is theirs to end
        if (this.ownsStream) {
            for (const track of this.stream.getTracks()) {
                track.removeEventListener("mute", this._boundHandleTrackMute);
                track.stop();
            }
        }

        this.pcmWorklet.port.postMessage({ type: "stop" });
        this.pcmWorklet.port.onmessage = null;
        this.pcmWorklet.port.close();
        this.pcmWorklet.disconnect();

        this.source.disconnect();

        await this.audioContext.close();
    }
}

/**
 * Starts capturing PCM samples.
 *
 * @param externalStream - Stream to record instead of the microphone. Its
 * tracks are left running when the recorder stops.
 */
/** How long a resume waits for the worklet to confirm an earlier pause. */
const PAUSE_ACK_TIMEOUT_MS = 500;

export async function startPcmRecorder(externalStream?: MediaStream) {
    const stream =
        externalStream ??
        (await navigator.mediaDevices.getUserMedia({
            audio: true,
        }));

    const audioContext = new AudioContext();

    await audioContext.audioWorklet.addModule(PCMAudioWorkletUrl);
    // bind the source to one known track, so isHealthy watches the right one
    const inputTrack = stream.getAudioTracks()[0];
    if (!inputTrack) {
        throw new Error("The stream has no audio track to record");
    }
    const source = audioContext.createMediaStreamSource(
        new MediaStream([inputTrack]),
    );

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

    const recorder = new PCMRecorder(
        stream,
        audioContext,
        pcmWorklet,
        source,
        audioContext.sampleRate,
        externalStream === undefined,
        inputTrack,
    );
    await recorder.startKeepAwake();

    return recorder;
}
