<script setup lang="ts">
import { ref } from "vue";
import { useAudioRecording } from "../../src/runtime/composables/useAudioRecording";

/*
    Records a stream supplied through `getStream` instead of the microphone,
    the way an app records a meeting (microphone mixed with screen audio).
    A tone stands in for that mix; the e2e tests drive this page.
*/

let toneContext: AudioContext | undefined;
const sourceStream = ref<MediaStream>();
const recordedSize = ref<number>();

const { isRecording, error, startRecording, stopRecording } = useAudioRecording(
    {
        storeToDbInterval: 1,
        getStream: async () => {
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
    },
);

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
    <p data-testid="error">{{ error }}</p>
    <p data-testid="size">{{ recordedSize }}</p>
  </div>
</template>
