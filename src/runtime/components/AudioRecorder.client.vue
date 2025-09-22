<script setup lang="ts">
import UButton from "@nuxt/ui/components/Button.vue";
import { computed, ref } from "vue";
import { useAudioRecording } from "../composables/audioRecoding";
import AudioVisualizer from "./AudioVisualizer.client.vue";
import { useI18n } from "vue-i18n";

const stream = ref<MediaStream>();
const { t } = useI18n();
// const t = $t as (key: string) => string;

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
            {{ t('audio-recorder.audio.startRecording') }}
        </UButton>

        <div v-if="isRecording" class="recording-indicator">
            {{ t('audio-recorder.audio.recordingInProgress') }}
            <div class="recording-time">{{ formattedRecordingTime }}</div>
            <AudioVisualizer :stream="stream" :isRecording="isRecording" />
        </div>

        <div class="flex justify-center gap-2 mb-2">
            <UButton v-if="isRecording" color="secondary" icon="i-lucide-square" @click="stopRecording" size="xl">
                {{ t('audio-recorder.audio.stopRecording') }}
            </UButton>
        </div>

        <div v-if="audioUrl" class="playback-section">
            <audio :src="audioUrl" controls></audio>
            <a :href="audioUrl" :download="`recording-${new Date().toISOString()}.webm`" class="download-link">
                {{ t('audio-recorder.audio.downloadRecording') }}
            </a>
        </div>

        <div v-if="error" class="error-message">
            <p>{{ error }}</p>
            <ul v-if="
                error.includes(t('audio-recorder.audio.errors.noMicrophoneFound')) ||
                error.includes(t('audio-recorder.audio.errors.accessDenied'))
            ">
                <li>{{ t('audio-recorder.audio.errors.troubleshooting.properlyConnected') }}</li>
                <li>{{ t('audio-recorder.audio.errors.troubleshooting.checkPermissions') }}</li>
                <li>{{ t('audio-recorder.audio.errors.troubleshooting.differentBrowser') }}</li>
                <li>{{ t('audio-recorder.audio.errors.troubleshooting.restart') }}</li>
            </ul>
        </div>
    </div>
</template>