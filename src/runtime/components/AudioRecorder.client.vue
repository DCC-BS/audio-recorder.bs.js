<script setup lang="ts">
import UButton from "@nuxt/ui/components/Button.vue";
import { AnimatePresence, motion } from "motion-v";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAudioRecording } from "../composables/audioRecoding";
import AudioVisualizer from "./AudioVisualizer.client.vue";

interface Props {
    showResult?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    showResult: true,
});

const emit = defineEmits<{
    (e: "recording-started", stream: MediaStream): void;
    (e: "recording-stopped", audioBlob: Blob, audioUrl: string): void;
}>();

const stream = ref<MediaStream>();
const { t } = useI18n();

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
        emit("recording-started", s);
    },
    onRecordingStopped: (audioBlob: Blob, audioUrl: string) => {
        emit("recording-stopped", audioBlob, audioUrl);
    },
    storeToDbInterval: 10,
});

const formattedRecordingTime = computed(() => {
    const minutes = Math.floor(recordingTime.value / 60);
    const seconds = recordingTime.value % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
});
</script>

<template>
    <div
        class="max-w-2xl mx-auto p-8 bg-slate-50 dark:bg-slate-900 rounded-3xl shadow-xl border border-slate-200/50 dark:border-slate-700/50">
        <!-- Start Recording Button -->
        <AnimatePresence>
            <motion.div v-if="!isRecording" key="start-button" :initial="{ opacity: 0, scale: 0.8, y: 20 }"
                :animate="{ opacity: 1, scale: 1, y: 0 }" :exit="{ opacity: 0, scale: 0.8, y: -20 }"
                :transition="{ duration: 0.5, type: 'spring', bounce: 0.3 }" class="text-center">
                <div>
                    <UButton color="primary" icon="i-lucide-mic" @click="startRecording" size="xl"
                        class="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border-0">
                        {{ t('audio-recorder.audio.startRecording') }}
                    </UButton>
                </div>
                <motion.p class="mt-4 text-slate-600 dark:text-slate-400 text-sm" :initial="{ opacity: 0 }"
                    :animate="{ opacity: 1 }" :transition="{ delay: 0.3 }">
                    Click to start your audio recording
                </motion.p>
            </motion.div>
        </AnimatePresence>

        <!-- Recording Indicator -->
        <AnimatePresence>
            <motion.div v-if="isRecording" key="recording-section" :initial="{ opacity: 0, scale: 0.9 }"
                :animate="{ opacity: 1, scale: 1 }" :exit="{ opacity: 0, scale: 0.9 }"
                :transition="{ duration: 0.4, type: 'spring' }" class="text-center space-y-6">
                <!-- Recording Status -->
                <div class="flex items-center justify-center gap-3">
                    <motion.div class="w-4 h-4 bg-red-500 rounded-full"
                        :animate="{ scale: [1, 1.2, 1], opacity: [1, 0.7, 1] }"
                        :transition="{ duration: 1.5, repeat: Infinity }"></motion.div>
                    <span class="text-lg font-medium text-red-600 dark:text-red-400">
                        {{ t('audio-recorder.audio.recordingInProgress') }}
                    </span>
                </div>

                <!-- Recording Time -->
                <motion.div
                    class="bg-slate-900/5 dark:bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-slate-200/30 dark:border-slate-700/30"
                    :initial="{ scale: 0.8 }" :animate="{ scale: 1 }" :transition="{ delay: 0.2, type: 'spring' }">
                    <motion.div layout class="recording-time text-4xl font-mono font-bold text-slate-800 dark:text-slate-200 mb-2">
                        {{ formattedRecordingTime }}
                    </motion.div>
                    <p class="text-sm text-slate-600 dark:text-slate-400">{{ t("audio-recorder.audio.recordingTime") }}</p>
                </motion.div>

                <!-- Audio Visualizer -->
                <motion.div :initial="{ opacity: 0, y: 20 }" :animate="{ opacity: 1, y: 0 }"
                    :transition="{ delay: 0.4 }"
                    class="bg-slate-900/5 dark:bg-white/5 backdrop-blur-sm rounded-2xl p-4 border border-slate-200/30 dark:border-slate-700/30">
                    <AudioVisualizer :stream="stream" :isRecording="isRecording" />
                </motion.div>

                <!-- Stop Recording Button -->
                <motion.div :initial="{ opacity: 0, scale: 0.8 }" :animate="{ opacity: 1, scale: 1 }"
                    :transition="{ delay: 0.6, type: 'spring' }">
                    <div>
                        <UButton color="secondary" icon="i-lucide-square" @click="stopRecording" size="xl"
                            class="bg-red-500 hover:bg-red-600 text-white font-semibold px-8 py-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border-0">
                            {{ t('audio-recorder.audio.stopRecording') }}
                        </UButton>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>

        <!-- Playback Section -->
        <AnimatePresence>
            <motion.div v-if="audioUrl && props.showResult" key="playback-section"
                :initial="{ opacity: 0, y: 30, scale: 0.9 }" :animate="{ opacity: 1, y: 0, scale: 1 }"
                :exit="{ opacity: 0, y: -30, scale: 0.9 }" :transition="{ duration: 0.5, type: 'spring', bounce: 0.2 }"
                class="mt-8 bg-green-50 dark:bg-green-900/20 rounded-2xl p-6 border border-green-200/50 dark:border-green-700/50">
                <motion.div class="text-center space-y-4" :initial="{ y: 20 }" :animate="{ y: 0 }"
                    :transition="{ delay: 0.2 }">
                    <motion.div class="flex items-center justify-center gap-2 mb-4" :initial="{ opacity: 0 }"
                        :animate="{ opacity: 1 }" :transition="{ delay: 0.3 }">
                        <div class="w-3 h-3 bg-green-500 rounded-full"></div>
                        <span class="text-green-700 dark:text-green-300 font-medium">Recording Complete</span>
                    </motion.div>

                    <motion.div
                        class="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-xl p-4 border border-white/20 dark:border-slate-700/20"
                        :whileHover="{ scale: 1.02 }" :transition="{ type: 'spring', stiffness: 300 }">
                        <audio :src="audioUrl" controls class="w-full h-12 rounded-lg shadow-sm"></audio>
                    </motion.div>

                    <motion.a :href="audioUrl" :download="`recording-${new Date().toISOString()}.webm`"
                        class="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-medium px-6 py-3 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-sm"
                        :whileHover="{ scale: 1.05, y: -2 }" :whileTap="{ scale: 0.95 }"
                        :transition="{ type: 'spring', stiffness: 400, damping: 17 }">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z">
                            </path>
                        </svg>
                        {{ t('audio-recorder.audio.downloadRecording') }}
                    </motion.a>
                </motion.div>
            </motion.div>
        </AnimatePresence>

        <!-- Error Messages -->
        <AnimatePresence>
            <motion.div v-if="error" key="error-section" :initial="{ opacity: 0, x: -20, scale: 0.95 }"
                :animate="{ opacity: 1, x: 0, scale: 1 }" :exit="{ opacity: 0, x: 20, scale: 0.95 }"
                :transition="{ duration: 0.4, type: 'spring' }"
                class="mt-8 bg-red-50 dark:bg-red-900/20 rounded-2xl p-6 border border-red-200/50 dark:border-red-700/50">
                <motion.div class="flex items-start gap-3" :initial="{ y: 10 }" :animate="{ y: 0 }"
                    :transition="{ delay: 0.1 }">
                    <motion.div
                        class="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                        :animate="{ rotate: [0, 10, -10, 0] }" :transition="{ duration: 0.5, delay: 0.2 }">
                        <svg class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd"
                                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                                clip-rule="evenodd"></path>
                        </svg>
                    </motion.div>
                    <div class="flex-1">
                        <motion.p class="text-red-800 dark:text-red-200 font-medium mb-3" :initial="{ opacity: 0 }"
                            :animate="{ opacity: 1 }" :transition="{ delay: 0.2 }">
                            {{ error }}
                        </motion.p>
                        <motion.ul v-if="
                            error.includes(t('audio-recorder.audio.errors.noMicrophoneFound')) ||
                            error.includes(t('audio-recorder.audio.errors.accessDenied'))
                        " class="space-y-2 text-red-700 dark:text-red-300 text-sm" :initial="{ opacity: 0 }"
                            :animate="{ opacity: 1 }" :transition="{ delay: 0.4 }">
                            <motion.li class="flex items-center gap-2" v-for="(item, index) in [
                                t('audio-recorder.audio.errors.troubleshooting.properlyConnected'),
                                t('audio-recorder.audio.errors.troubleshooting.checkPermissions'),
                                t('audio-recorder.audio.errors.troubleshooting.differentBrowser'),
                                t('audio-recorder.audio.errors.troubleshooting.restart')
                            ]" :key="index" :initial="{ opacity: 0, x: -10 }" :animate="{ opacity: 1, x: 0 }"
                                :transition="{ delay: 0.5 + index * 0.1 }">
                                <div class="w-1.5 h-1.5 bg-red-400 rounded-full"></div>
                                {{ item }}
                            </motion.li>
                        </motion.ul>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    </div>
</template>