import PCMAudioWorkletUrl from "../assets/pcm-recorder-worklet.js?url";


export class PCMRecorder {
    listeners: Array<(data: Float32Array) => void> = [];
    
    constructor(
        public readonly stream: MediaStream,
        public readonly audioContext: AudioContext,
        public readonly pcmWorklet: AudioWorkletNode,
        public readonly source: MediaStreamAudioSourceNode,
        public readonly sampleRate: number = audioContext.sampleRate) {
        // Receive raw PCM frames from the worklet
        pcmWorklet.port.onmessage = async (event) => {
            try {
                if (event.data.type === "data") {
                    const pcmData: Float32Array = event.data.pcmData;
                    for (const listener of this.listeners) {
                        listener(pcmData);
                    }
                }
            } catch (e) {
                console.error("Error processing PCM data:", e);
            }
        };
    }

    public onPCMData(listener: (data: Float32Array) => void) {
        this.listeners.push(listener);
    }

    public async stop() {
        this.pcmWorklet.port.postMessage({ type: "stop" });
        this.source.disconnect();
        this.pcmWorklet.disconnect();
        this.audioContext.close();

        for (const track of this.stream.getTracks()) {
            track.stop();
        }

        // Stop the worklet message port
        this.pcmWorklet.port.onmessage = null;
        this.pcmWorklet.port.close();

        // Disconnect audio nodes
        this.source.disconnect();
        this.pcmWorklet.disconnect();

        // Stop all media tracks
        for (const track of this.stream.getTracks()) {
            track.stop();
        }

        // Close the audio context (this will unload the worklet module)
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
    pcmWorklet.connect(audioContext.destination); // or audioContext.createGain() if you don’t want local playback

    // Setup for iOS background audio
    if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: "Active Recording",
            artist: "Transcribo",
            album: "Transcribo",
        });

        navigator.mediaSession.playbackState = "none";
    }

    return new PCMRecorder(stream, audioContext, pcmWorklet, source);
}