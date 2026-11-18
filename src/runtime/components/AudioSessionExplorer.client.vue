<script setup lang="ts">
import { AnimatePresence, motion } from "motion-v";
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useFFmpeg } from "#imports";
import {
    AudioStorageService,
    SessionChanged,
    SessionInUse,
} from "../services/audioStorage";
import type { AudioSession } from "../services/db";
import type { AudioSessionExplorerProps, CustomAction } from "../types";

const props = withDefaults(defineProps<AudioSessionExplorerProps>(), {
    showDownloadButton: true,
    showDeleteButton: true,
    customActions: () => [],
});

const audioStorage = new AudioStorageService();

const { t } = useI18n();

const sessions = ref<AudioSession[]>([]);
const isLoading = ref(true);
const deletingSessionId = ref<string | null>(null);
const downloadingSessionId = ref<string | null>(null);
const actionLoadingStates = ref<Record<string, string | null>>({});
const deleteError = ref<string>();
const { concatMp3 } = useFFmpeg();

onMounted(async () => {
    try {
        // sessions recorded in some tab right now are not listed
        const fetchedSessions = await audioStorage.getResumableSessions();
        sessions.value = fetchedSessions;
    } catch (error) {
        console.error("Failed to load sessions:", error);
    } finally {
        isLoading.value = false;
    }
});

/**
 * Deletes a listed session; the list may be stale.
 *
 * @param expectedChunkCount - Only delete the audio a custom action handled.
 * @throws SessionInUse, SessionChanged
 */
async function deleteSession(
    sessionId: string,
    expectedChunkCount?: number,
): Promise<void> {
    deletingSessionId.value = sessionId;
    deleteError.value = undefined;
    try {
        await audioStorage.deleteStoredSession(sessionId, expectedChunkCount);
        sessions.value = sessions.value.filter((s) => s.id !== sessionId);
    } catch (error) {
        console.error("Failed to delete session:", error);
        if (error instanceof SessionInUse) {
            deleteError.value = t("audio-recorder.audio.errors.sessionInUse");
        } else if (error instanceof SessionChanged) {
            deleteError.value = t("audio-recorder.audio.errors.sessionChanged");
        }
        throw error;
    } finally {
        deletingSessionId.value = null;
    }
}

/** The built-in Delete button; a refusal is shown, not thrown. */
function onDelete(sessionId: string): void {
    deleteSession(sessionId).catch(() => {});
}

async function downloadAudio(sessionId: string): Promise<void> {
    downloadingSessionId.value = sessionId;
    try {
        const mp3Blob = await getMp3Blob(sessionId);

        const url = URL.createObjectURL(mp3Blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `session-${sessionId}.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error("Failed to download audio:", error);
    } finally {
        downloadingSessionId.value = null;
    }
}

async function getMp3Blob(sessionId: string): Promise<Blob> {
    return (await exportSession(sessionId)).mp3Blob;
}

async function exportSession(
    sessionId: string,
): Promise<{ mp3Blob: Blob; chunkCount: number }> {
    const chunks = await audioStorage.getSessionChunks(sessionId);
    if (chunks.length === 0) {
        throw new Error("No audio chunks found for this session");
    }
    return { mp3Blob: await concatMp3(chunks), chunkCount: chunks.length };
}

async function handleCustomAction(
    action: CustomAction,
    sessionId: string,
    actionKey: string,
): Promise<void> {
    actionLoadingStates.value[actionKey] = sessionId;
    try {
        const { mp3Blob, chunkCount } =
            action.needsAudio === false
                ? {
                      mp3Blob: new Blob([], { type: "audio/mp3" }),
                      chunkCount: undefined,
                  }
                : await exportSession(sessionId);

        const deleteSessionFn = () => deleteSession(sessionId, chunkCount);

        await action.handler(sessionId, mp3Blob, deleteSessionFn, chunkCount);
    } catch (error) {
        console.error("Failed to handle custom action:", error);
    } finally {
        actionLoadingStates.value[actionKey] = null;
    }
}

function getActionKey(index: number, sessionId: string): string {
    return `action-${index}-${sessionId}`;
}

function formatFileSize(bytes: number): string {
    return (bytes / (1024 * 1024)).toFixed(2);
}

function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleString();
}
</script>

<template>
    <UContainer class="py-8">
        <!-- Header Section -->
        <motion.div :initial="{ opacity: 0, y: -20 }" :animate="{ opacity: 1, y: 0 }" :transition="{ duration: 0.6 }"
            class="text-center mb-8">
            <h1 class="text-4xl font-bold text-gray-900 dark:text-white mb-2">
                {{ t('audio-recorder.sessionExplorer.title') }}
            </h1>
            <p class="text-gray-600 dark:text-gray-400">
                {{ t('audio-recorder.sessionExplorer.subtitle') }}
            </p>
        </motion.div>

        <UAlert v-if="deleteError" color="error" variant="subtle" :description="deleteError" class="mb-4"
            role="alert" />

        <!-- Loading State -->
        <motion.div v-if="isLoading" :initial="{ opacity: 0 }" :animate="{ opacity: 1 }" :exit="{ opacity: 0 }"
            class="flex justify-center items-center py-12">
            <UIcon name="i-lucide-loader-2" class="animate-spin text-4xl text-primary-500" />
            <span class="ml-3 text-lg text-gray-600 dark:text-gray-400">{{ t('audio-recorder.sessionExplorer.loading')
            }}</span>
        </motion.div>

        <!-- Empty State -->
        <motion.div v-else-if="sessions.length === 0" :initial="{ opacity: 0, scale: 0.9 }"
            :animate="{ opacity: 1, scale: 1 }" :transition="{ duration: 0.5 }" class="text-center py-16">
            <UIcon name="i-lucide-music" class="text-2xl text-gray-400 dark:text-gray-600 mb-4" />
            <h3 class="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
                {{ t('audio-recorder.sessionExplorer.emptyTitle') }}
            </h3>
            <p class="text-gray-500 dark:text-gray-500">
                {{ t('audio-recorder.sessionExplorer.emptySubtitle') }}
            </p>
        </motion.div>

        <!-- Sessions Grid -->
        <div v-else class="space-y-4">
            <AnimatePresence>
                <motion.div v-for="(session, index) in sessions" :key="session.id"
                    :initial="{ opacity: 0, x: -50, scale: 0.95 }" :animate="{ opacity: 1, x: 0, scale: 1 }"
                    :exit="{ opacity: 0, x: 50, scale: 0.95 }" :transition="{ duration: 0.4, delay: index * 0.1 }"
                    layout>
                    <UCard
                        class="hover:shadow-lg transition-all duration-300 hover:scale-[1.02] border border-gray-200 dark:border-gray-700"
                        :ui="{
                            body: { padding: 'p-6' },
                            header: { padding: 'px-6 pt-6 pb-0' }
                        }">
                        <template #header>
                            <div class="flex items-center justify-between">
                                <div class="flex items-center space-x-3">
                                    <div
                                        class="flex items-center justify-center p-2 bg-primary-100 dark:bg-primary-900 rounded-lg">
                                        <UIcon name="i-lucide-audio-waveform"
                                            class="text-primary-600 dark:text-primary-400 text-xl" />
                                    </div>
                                    <div>
                                        <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
                                            {{ session.name }}
                                            <UBadge :color="session.status === 'paused' ? 'warning' : 'neutral'"
                                                variant="subtle" size="sm" class="ml-2 align-middle">
                                                {{ t(`audio-recorder.sessionExplorer.status.${session.status ?? 'recording'}`) }}
                                            </UBadge>
                                        </h3>
                                        <p class="text-sm text-gray-500 dark:text-gray-400">
                                            {{ t('audio-recorder.sessionExplorer.sessionId') }}: {{ session.id.slice(0,
                                                8) }}...
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </template>

                        <div class="space-y-4">
                            <!-- Session Info -->
                            <div class="flex justify-between">
                                <div class="flex items-center space-x-2">
                                    <UIcon name="i-lucide-calendar" class="text-gray-400" />
                                    <span class="text-sm text-gray-600 dark:text-gray-400">
                                        {{ formatDate(session.createdAt) }}
                                    </span>
                                </div>
                                <div class="flex items-center space-x-2">
                                    <UIcon name="i-lucide-hard-drive" class="text-gray-400" />
                                    <span class="text-sm text-gray-600 dark:text-gray-400">
                                        {{ formatFileSize(session.totalSize) }} {{
                                            t('audio-recorder.sessionExplorer.size') }}
                                    </span>
                                </div>
                            </div>

                            <!-- Action Buttons -->
                            <div class="flex gap-2 justify-end pt-4 border-t border-gray-100 dark:border-gray-800">
                                <!-- Custom Actions (Left of Download) -->
                                <template v-for="(action, index) in props.customActions" :key="getActionKey(index, session.id)">
                                <UButton v-if="!action.visible || action.visible(session)"
                                    @click="handleCustomAction(action, session.id, getActionKey(index, session.id))"
                                    :color="action.color || 'primary'" :variant="action.variant || 'soft'"
                                    :icon="action.icon"
                                    :loading="action.loading || actionLoadingStates[getActionKey(index, session.id)] === session.id"
                                    :disabled="action.disabled || actionLoadingStates[getActionKey(index, session.id)] === session.id || downloadingSessionId === session.id || deletingSessionId === session.id"
                                    class="transition-all duration-200 hover:scale-105">
                                    {{ action.label }}
                                </UButton>
                                </template>

                                <!-- Slot for additional custom actions -->
                                <slot name="actions" :session="session" :get-mp3-blob="() => getMp3Blob(session.id)"
                                    :delete-session="() => deleteSession(session.id)" />

                                <UButton v-if="props.showDownloadButton" @click="downloadAudio(session.id)"
                                    color="primary" variant="soft" icon="i-lucide-download"
                                    :loading="downloadingSessionId === session.id"
                                    :disabled="downloadingSessionId === session.id || deletingSessionId === session.id"
                                    class="transition-all duration-200 hover:scale-105">
                                    {{ downloadingSessionId === session.id ?
                                        t('audio-recorder.sessionExplorer.downloading') :
                                        t('audio-recorder.sessionExplorer.downloadMp3') }}
                                </UButton>

                                <UButton v-if="props.showDeleteButton" @click="onDelete(session.id)"
                                    color="error" variant="soft" icon="i-lucide-trash-2"
                                    :loading="deletingSessionId === session.id"
                                    :disabled="deletingSessionId === session.id || downloadingSessionId === session.id"
                                    class="transition-all duration-200 hover:scale-105">
                                    {{ deletingSessionId === session.id ? t('audio-recorder.sessionExplorer.deleting') :
                                        t('audio-recorder.sessionExplorer.delete') }}
                                </UButton>
                            </div>
                        </div>
                    </UCard>
                </motion.div>
            </AnimatePresence>
        </div>

        <!-- Session Count -->
        <motion.div v-if="!isLoading && sessions.length > 0" :initial="{ opacity: 0, y: 20 }"
            :animate="{ opacity: 1, y: 0 }" :transition="{ duration: 0.5, delay: 0.8 }"
            class="text-center mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
            <p class="text-sm text-gray-500 dark:text-gray-400">
                {{ t('audio-recorder.sessionExplorer.count', sessions.length) }}
            </p>
        </motion.div>
    </UContainer>
</template>