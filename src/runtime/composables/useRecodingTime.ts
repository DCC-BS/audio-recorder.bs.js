import { ref } from "vue";


export function useRecordingTime() {
    const recordingStartTime = ref(0);
    const recordingTime = ref(0);

    const recordingInterval = ref<NodeJS.Timeout>();

    function startTime(){ 
        recordingStartTime.value = Date.now();
        recordingTime.value = 0;

        // Start the timer to display recording duration
        recordingInterval.value = setInterval(() => {
            recordingTime.value = Math.floor(
                (Date.now() - recordingStartTime.value) / 1000
            );
        }, 1000);
    }

    function stopTime(){
        if (recordingInterval.value) {
            clearInterval(recordingInterval.value);
            recordingInterval.value = undefined;
        }
    }

    return {
        startTime,
        stopTime,
        recordingTime
    }
}