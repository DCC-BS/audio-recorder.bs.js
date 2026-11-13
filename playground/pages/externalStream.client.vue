<script setup lang="ts">
import { ref } from "vue";
import { useAudioRecording } from "../../src/runtime/composables/useAudioRecording";

/*
    Records a stream supplied through `getStream` instead of the microphone,
    the way an app records a meeting (microphone mixed with screen audio).
    A tone stands in for that mix; the e2e tests drive this page.
*/

// ?fail=1 makes getStream reject, like a cancelled screen picker
const failStart = new URLSearchParams(location.search).has("fail");
let toneContext: AudioContext | undefined;
const sourceStream = ref<MediaStream>();
const recordedSize = ref<number>();

const { isRecording, isProcessing, error, startRecording, stopRecording } =
    useAudioRecording({
        storeToDbInterval: 1,
        getStream: async () => {
            // read by the e2e tests: a second start must not ask again
            const w = window as unknown as { streamRequests?: number };
            w.streamRequests = (w.streamRequests ?? 0) + 1;
            if (failStart) {
                throw new DOMException(
                    "Screen share cancelled",
                    "NotAllowedError",
                );
            }
            toneContext = new AudioContext();
            const oscillator = toneContext.createOscillator();
            const destination = toneContext.createMediaStreamDestination();
            oscillator.connect(destination);
            oscillator.start();
            sourceStream.value = destination.stream;
            // read by the e2e tests: the recorder must leave it running
            (window as unknown as { sourceStream: MediaStream }).sourceStream =
                destination.stream;
            return destination.stream;
        },
        onRecordingStopped: (blob) => {
            recordedSize.value = blob.size;
        },
    });

/**
 * Ends the tone the recorder was given; the recorder leaves it running.
 */
function releaseSource(): void {
    for (const track of sourceStream.value?.getTracks() ?? []) {
        track.stop();
    }
    void toneContext?.close();
}
</script>

<template>
  <div>
    <button data-testid="start" @click="startRecording">Start</button>
    <button data-testid="stop" @click="stopRecording">Stop</button>
    <button data-testid="release" @click="releaseSource">Release</button>
    <p data-testid="recording">{{ isRecording }}</p>
    <p data-testid="processing">{{ isProcessing }}</p>
    <p data-testid="error">{{ error }}</p>
    <p data-testid="size">{{ recordedSize }}</p>
  </div>
</template>
