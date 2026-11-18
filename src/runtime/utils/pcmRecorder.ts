import PCMAudioWorkletUrl from "../assets/pcm-recorder-worklet.js?url";
import { KeepAwake } from "./keepAwake";

export class PCMRecorder {
    listeners: Array<(data: Float32Array) => void> = [];
    private keepAwake: KeepAwake;
    private _onContextSuspended?: () => void;
    private _onInterrupted?: () => void;
    /** Held paused with the devices kept open; see pause(). */
    private _paused = false;
    private _logger: (msg: string) => void;
    private _wasSuspended = false;
    private _boundHandleStateChange: () => void;
    private _boundHandleTrackMute: () => void;

    constructor(
        public readonly stream: MediaStream,
        public readonly audioContext: AudioContext,
        public readonly pcmWorklet: AudioWorkletNode,
        public readonly source: MediaStreamAudioSourceNode,
        public readonly sampleRate: number = audioContext.sampleRate,
        /** Whether stop() ends the stream's tracks; false for a caller's stream. */
        private readonly ownsStream: boolean = true,
    ) {
        this._logger = () => {};
        this.keepAwake = new KeepAwake(this._logger);
        this._boundHandleStateChange = this.handleStateChange.bind(this);
        this._boundHandleTrackMute = this.handleTrackMute.bind(this);

        this.audioContext.addEventListener(
            "statechange",
            this._boundHandleStateChange,
        );

        // WebKit mutes the microphone track while a call or Siri takes the
        // microphone away; only our own microphone is watched, a caller's
        // stream may mute for reasons of its own
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

    /**
     * Called when the system takes the audio away (phone call, Siri):
     * WebKit's `interrupted` context state or a muted microphone track.
     * While set, an interrupted context is no longer resumed on its own.
     */
    setOnInterrupted(callback: (() => void) | undefined): void {
        this._onInterrupted = callback;
    }

    get wasSuspended(): boolean {
        return this._wasSuspended;
    }

    /**
     * Whether the devices still deliver audio, i.e. a paused recorder can
     * be resumed instead of replaced.
     */
    get isHealthy(): boolean {
        return (
            this.audioContext.state !== "closed" &&
            this.stream
                .getAudioTracks()
                .every((t) => t.readyState === "live" && !t.muted)
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
        // paused on purpose: whatever happens to the context is sorted out
        // on resume
        if (this._paused) {
            return;
        }

        // WebKit-only state for a phone call, Siri and the like
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

    /**
     * Pauses while keeping the devices open, so resuming needs no new
     * permission. Samples keep arriving; the caller drops them.
     */
    public pause(): void {
        this._paused = true;
        this.keepAwake.stop();
    }

    /**
     * Resumes after {@link pause}.
     */
    public async resume(): Promise<void> {
        if (this.audioContext.state !== "running") {
            await this.audioContext.resume();
        }
        this._paused = false;
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
export async function startPcmRecorder(externalStream?: MediaStream) {
    const stream =
        externalStream ??
        (await navigator.mediaDevices.getUserMedia({
            audio: true,
        }));

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

    const recorder = new PCMRecorder(
        stream,
        audioContext,
        pcmWorklet,
        source,
        audioContext.sampleRate,
        externalStream === undefined,
    );
    await recorder.startKeepAwake();

    return recorder;
}
