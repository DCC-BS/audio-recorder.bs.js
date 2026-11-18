// pcm-recorder-worklet.js
class PCMRecorderProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.paused = false;
        this.port.onmessage = (event) => {
            if (event.data?.type === "pause") {
                this.paused = true;
                // ordered after every block posted so far
                this.port.postMessage({ type: "paused" });
            } else if (event.data?.type === "resume") {
                this.paused = false;
            }
        };
    }

    process(inputs, _, __) {
        if (this.paused) {
            return true;
        }
        const input = inputs[0];
        if (!input || input.length === 0) {
            return true;
        }

        const channelData = input[0]; // mono; Float32Array

        // Copy the data so it’s transferable and not reused by the engine
        const copy = new Float32Array(channelData.length);
        copy.set(channelData);

        this.port.postMessage({
            type: "data",
            samples: copy,
        });

        return true; // keep processor alive
    }
}

registerProcessor("pcm-recorder", PCMRecorderProcessor);
