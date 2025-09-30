<script setup>
import { ref, watch } from "vue";
const props = defineProps({
  stream: { type: null, required: true },
  isRecording: { type: Boolean, required: true }
});
const audioVisualization = ref([]);
const audioContext = ref();
const analyser = ref();
const frequencyData = ref();
const visualizationInterval = ref(void 0);
watch(
  () => props.stream,
  (newStream) => {
    if (newStream) {
      initializeAudioVisualization(newStream);
    }
  },
  { immediate: true }
);
watch(
  () => props.isRecording,
  (newVal) => {
    if (newVal) {
      visualizationInterval.value = setInterval(
        () => updateAudioVisualization(),
        50
      );
    } else if (visualizationInterval.value) {
      clearInterval(visualizationInterval.value);
      visualizationInterval.value = void 0;
      if (audioContext.value) {
        audioContext.value.close();
        audioContext.value = void 0;
      }
    }
  },
  { immediate: true }
);
function initializeAudioVisualization(stream) {
  if (audioContext.value) {
    audioContext.value.close();
  }
  audioContext.value = new AudioContext();
  const source = audioContext.value.createMediaStreamSource(stream);
  analyser.value = audioContext.value.createAnalyser();
  analyser.value.fftSize = 256;
  frequencyData.value = new Uint8Array(analyser.value.frequencyBinCount);
  source.connect(analyser.value);
}
function updateAudioVisualization() {
  if (analyser.value && frequencyData.value) {
    analyser.value.getByteFrequencyData(frequencyData.value);
    const barCount = 50 / 2;
    const freqData = Array.from(frequencyData.value);
    const freqPerBar = Math.floor(freqData.length / barCount);
    const averagedData = [];
    for (let i = 0; i < barCount; i++) {
      const start = i * freqPerBar;
      const end = start + freqPerBar;
      const slice = freqData.slice(start, end);
      const avg = slice.reduce((sum, val) => sum + val, 0) / slice.length || 0;
      averagedData.push(avg / 255 * 100);
    }
    audioVisualization.value = [
      ...averagedData.toReversed(),
      ...averagedData
    ];
  } else {
    audioVisualization.value = [];
  }
}
</script>

<template>
    <div class="flex justify-between items-center h-[50px] mt-[10px]">
        <div v-for="(value, index) in audioVisualization" :key="index" :style="{ height: value + '%' }"
            class="w-[2%] bg-primary" :transition="{ duration: 0.1 }" />
    </div>
</template>
