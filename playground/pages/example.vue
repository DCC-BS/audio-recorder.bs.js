<script setup lang="ts">
import { computed, ref } from "vue";
import type AudioRecorder from "../../src/runtime/components/AudioRecorder.client.vue";

const recorderRef = ref<InstanceType<typeof AudioRecorder>>();

const isRecording = computed(() => recorderRef.value?.isRecording);
const formattedTime = computed(() => recorderRef.value?.formattedRecordingTime);

function startRecording() {
    recorderRef.value?.startRecording();
}

function stopRecording() {
    recorderRef.value?.stopRecording();
}
</script>

<template>
  <div>
    <AudioRecorder ref="recorderRef" />
    <button @click="startRecording">Start</button>
    <button @click="stopRecording">Stop</button>
    <p>Recording: {{ isRecording }}</p>
    <p>Time: {{ formattedTime }}</p>
  </div>
</template>