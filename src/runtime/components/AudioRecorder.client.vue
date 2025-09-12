<script setup lang="ts">
import UButton from "@nuxt/ui/components/Button.vue";
import { useAudioRecording } from "../composables/audioRecoding";
import AudioVisualizer from "./AudioVisualizer.client.vue";

const stream = ref<MediaStream>();
const t = (key: string) => key; // Placeholder for translation function

const {
    isRecording,
    startRecording,
    stopRecording,
    recordingTime,
    error,
    audioUrl,
} = useAudioRecording({
    onRecordingStarted: (s: MediaStream) => {
        stream.value = s;
    },
});

const formattedRecordingTime = computed(() => {
    const minutes = Math.floor(recordingTime.value / 60);
    const seconds = recordingTime.value % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
});
</script>

<template>
    <div>
        <UButton v-if="!isRecording" color="primary" icon="i-lucide-mic" @click="startRecording" size="xl">
            Start Recording
        </UButton>

        <div v-if="isRecording" class="recording-indicator">
            {{ t('audio.recordingInProgress') }}
            <div class="recording-time">{{ formattedRecordingTime }}</div>
            <AudioVisualizer :stream="stream" :isRecording="isRecording" />
        </div>

        <div class="flex justify-center gap-2 mb-2">
            <UButton v-if="isRecording" color="secondary" icon="i-lucide-square" @click="stopRecording" size="xl">
                {{ t('audio.stopRecording') }}
            </UButton>
        </div>

        <div v-if="audioUrl" class="playback-section">
            <audio :src="audioUrl" controls></audio>
            <a :href="audioUrl" :download="`recording-${new Date().toISOString()}.webm`" class="download-link">
                {{ t('audio.downloadRecording') }}
            </a>
        </div>

        <div v-if="error" class="error-message">
            <p>{{ error }}</p>
            <ul v-if="
                error.includes(t('audio.errors.noMicrophoneFound')) ||
                error.includes(t('audio.errors.accessDenied'))
            ">
                <li>{{ t('audio.errors.troubleshooting.properlyConnected') }}</li>
                <li>{{ t('audio.errors.troubleshooting.checkPermissions') }}</li>
                <li>{{ t('audio.errors.troubleshooting.differentBrowser') }}</li>
                <li>{{ t('audio.errors.troubleshooting.restart') }}</li>
            </ul>
        </div>
    </div>
</template>

<style scoped></style>