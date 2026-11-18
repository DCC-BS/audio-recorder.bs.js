// pcm-recorder-worklet.js
class PCMRecorderProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        // while paused nothing is posted, so no block captured during a
        // pause can reach the recorder after it resumes
        this.paused = false;
        this.port.onmessage = (event) => {
            if (event.data?.type === "pause") {
                this.paused = true;
                // after every block posted so far, telling the recorder
                // that nothing from before the pause is still on its way
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
