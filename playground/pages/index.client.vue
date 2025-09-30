<script setup lang="ts">
import { useAudioRecording } from "../../src/runtime/composables/audioRecording";

const { abandonedRecording, getMp3Blob, deleteAbandonedRecording } =
    useAudioRecording({
        logger: console.log,
        deleteOldSessionsDaysInterval: 1, // 0.000694444444 = 1min
    });

async function downloadAudio(id: string) {
    const blob = await getMp3Blob(id);
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

    deleteAbandonedRecording(id);
}
</script>

<template>
    <div v-if="abandonedRecording.length > 0" class="text-center text-warning mt-5">
        <div class="text-3xl mb-4">⚠️ Found abandoned recordings ⚠️</div>

        <div v-for="value in abandonedRecording" :key="value.id">
            <div class="mb-2 flex gap-2 justify-center">
                <span>Recording started at: {{ new Date(value.createdAt).toLocaleString() }}</span>
                <UButton @click="downloadAudio(value.id)" color="secondary">Recover</UButton>
                <UButton @click="deleteAbandonedRecording(value.id)" color="error">Delete</UButton>
            </div>
        </div>
    </div>

    <div class="flex justify-center mt-10">
        <AudioRecorder />
    </div>
</template>