<script setup lang="ts">
import { motion } from "motion-v";
import { ref, watch } from "vue";

const props = defineProps<{
    stream: MediaStream | undefined;
    isRecording: boolean;
}>();

const audioVisualization = ref<number[]>([]);
const audioContext = ref<AudioContext>();
const analyser = ref<AnalyserNode>();
const frequencyData = ref<Uint8Array<ArrayBuffer>>();
const visualizationInterval = ref<NodeJS.Timeout | undefined>(undefined);

watch(
    () => props.stream,
    (newStream) => {
        if (newStream) {
            initializeAudioVisualization(newStream);
        }
    },
    { immediate: true },
);

watch(
    () => props.isRecording,
    (newVal) => {
        if (newVal) {
            // Start visualization when recording begins
            visualizationInterval.value = setInterval(
                () => updateAudioVisualization(),
                50,
            );
        } else if (visualizationInterval.value) {
            // Clean up visualization when recording stops
            clearInterval(visualizationInterval.value);
            visualizationInterval.value = undefined;

            // Close audio context if open
            if (audioContext.value) {
                audioContext.value.close();
                audioContext.value = undefined;
            }
        }
    },
    { immediate: true },
);

function initializeAudioVisualization(stream: MediaStream): void {
    // Close existing context if it exists
    if (audioContext.value) {
        audioContext.value.close();
    }

    // Create new audio context and analyzer
    audioContext.value = new AudioContext();
    const source = audioContext.value.createMediaStreamSource(stream);
    analyser.value = audioContext.value.createAnalyser();
    analyser.value.fftSize = 256; // Set FFT size for frequency analysis
    frequencyData.value = new Uint8Array(analyser.value.frequencyBinCount);
    source.connect(analyser.value);
}

/**
 * Update audio visualization with frequency data
 */
function updateAudioVisualization(): void {
    if (analyser.value && frequencyData.value) {
        analyser.value.getByteFrequencyData(frequencyData.value);

        const barCount = 50 / 2;
        const freqData = Array.from(frequencyData.value);
        const freqPerBar = Math.floor(freqData.length / barCount); // Number of frequency bins per bar
        const averagedData = [];
        for (let i = 0; i < barCount; i++) {
            const start = i * freqPerBar;
            const end = start + freqPerBar;
            const slice = freqData.slice(start, end);
            const avg =
                slice.reduce((sum, val) => sum + val, 0) / slice.length || 0;
            averagedData.push((avg / 255) * 100); // Normalize to percentage
        }

        audioVisualization.value = [
            ...averagedData.toReversed(),
            ...averagedData,
        ];

        // // Transform frequency data to visualization values (0-100%)
        // audioVisualization.value = Array.from(frequencyData.value)

        //     .slice(0, 50)
        //     .map((value) => (value / 255) * 100);
    } else {
        audioVisualization.value = [];
    }
}
</script>

<template>
    <div class="audio-visualization">
        <motion.div layout v-for="(value, index) in audioVisualization" :key="index" :style="{ height: value + '%' }"
            class="bar" :transition="{ duration: 0.1 }" />
    </div>
</template>

<style scoped>
.audio-visualization {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 50px;
    margin-top: 10px;
}

.audio-visualization .bar {
    width: 2%;
    background-color: #4caf50;
}
</style>