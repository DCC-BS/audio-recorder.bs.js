<script setup lang="ts">
import { useAudioSessions } from "../../src/runtime/composables/useAudioSessions";
import { isResumable } from "../../src/runtime/services/db";

const logs = ref<string[]>([]);
// a stored session to continue instead of starting a new one
const resumeId = ref<string>();
// remounts the recorder only when a continue target is picked, so
// clearing it after a finish keeps the delivered playback on screen
const recorderKey = ref(0);

function continueSession(id: string) {
    resumeId.value = id;
    recorderKey.value++;
}

function onFinished() {
    // the continued session was delivered and deleted
    resumeId.value = undefined;
    refresh();
}

const { abandonedRecording, exportSession, deleteAbandonedRecording, refresh } =
    useAudioSessions({
        logger: console.log,
        deleteOldSessionsDaysInterval: 1, // 0.000694444444 = 1min
    });

async function downloadAudio(id: string) {
    const { mp3Blob: blob, chunkCount } = await exportSession(id);
    if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `recording-${new Date().toISOString()}.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // refuses if another tab added audio after the export: it stays listed
    try {
        await deleteAbandonedRecording(id, chunkCount);
    } catch (e) {
        console.warn("Recording kept:", e);
        await refresh().catch((err) => {
            console.warn("Refreshing the list failed:", err);
        });
    }
}
</script>

<template>
    <div v-if="abandonedRecording && abandonedRecording.length > 0" class="text-center text-warning mt-5">
        <div class="text-3xl mb-4">⚠️ Found abandoned recordings ⚠️</div>

        <div v-for="value in abandonedRecording" :key="value.id">
            <div class="mb-2 flex gap-2 justify-center">
                <span>Recording started at: {{ new Date(value.createdAt).toLocaleString() }}</span>
                <span class="session-status">Status: {{ value.status }}</span>
                <UButton v-if="isResumable(value)" @click="continueSession(value.id)" color="primary">Continue</UButton>
                <UButton @click="downloadAudio(value.id)" color="secondary">Recover</UButton>
                <UButton @click="deleteAbandonedRecording(value.id)" color="error">Delete</UButton>
            </div>
        </div>
    </div>

    <div class="flex justify-center mt-10">
        <AudioRecorder :key="recorderKey" :resume-session-id="resumeId" @recording-stopped="onFinished" :store-to-db-interval="1" :logger="(l) => logs.push(l)" @recording-started="() => logs = []" />
    </div>

    <div v-for="log in logs">
        <div>{{ log }}</div>
    </div>
</template>