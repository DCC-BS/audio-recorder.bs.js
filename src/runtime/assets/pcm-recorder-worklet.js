// pcm-recorder-worklet.js
class PCMRecorderProcessor extends AudioWorkletProcessor {
    process(inputs, _, __) {
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