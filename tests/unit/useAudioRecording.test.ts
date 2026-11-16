// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
    createSession: vi.fn(async () => "session-1"),
    deleteSession: vi.fn(async () => {}),
    getSession: vi.fn(async () => ({ id: "session-1" })),
    getSessionChunks: vi.fn(async () => [new ArrayBuffer(8)]),
    storeAudioChunk: vi.fn(async () => {}),
}));

const recorder = vi.hoisted(() => ({
    stream: {} as MediaStream,
    sampleRate: 48000,
    stop: vi.fn(async () => {}),
    setLogger: vi.fn(),
    setOnContextSuspended: vi.fn(),
    onPCMData: vi.fn(),
    handleVisibilityChange: vi.fn(),
}));

const startPcmRecorder = vi.hoisted(() => vi.fn());

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../../src/runtime/services/audioStorage", () => ({
    AudioStorageService: vi.fn(() => storage),
}));
vi.mock("../../src/runtime/utils/pcmRecorder", () => ({ startPcmRecorder }));
vi.mock("../../src/runtime/utils/microphone", () => ({
    checkMicrophoneAvailability: vi.fn(async () => ({ isAvailable: true })),
    handleMicrophoneError: vi.fn(() => "microphone error"),
}));
vi.mock("../../src/runtime/composables/useFFmpeg", () => ({
    useFFmpeg: () => ({
        concatMp3: vi.fn(async () => new Blob(["mp3"])),
        pcmToMp3: vi.fn(async () => new Blob(["mp3"])),
    }),
}));

const { useAudioRecording } = await import(
    "../../src/runtime/composables/useAudioRecording"
);

describe("useAudioRecording.stopRecording", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        startPcmRecorder.mockImplementation(async () => recorder);
        URL.createObjectURL = vi.fn(() => "blob:audio");
        // the dev build logs storage usage while recording
        Object.defineProperty(navigator, "storage", {
            configurable: true,
            value: { estimate: async () => ({ usage: 0, quota: 1 }) },
        });
    });

    it("does nothing without a recording", async () => {
        const onError = vi.fn();
        const { stopRecording, error, isProcessing } = useAudioRecording({
            onError,
        });

        await stopRecording();

        expect(onError).not.toHaveBeenCalled();
        expect(error.value).toBeUndefined();
        expect(isProcessing.value).toBe(false);
    });

    it("cancels a start that is still waiting for the microphone", async () => {
        let grantMicrophone: (value: typeof recorder) => void = () => {};
        startPcmRecorder.mockImplementation(
            () =>
                new Promise((resolve) => {
                    grantMicrophone = resolve;
                }),
        );
        const onError = vi.fn();
        const onRecordingStarted = vi.fn();
        const { startRecording, stopRecording, isRecording, isBusy } =
            useAudioRecording({ onError, onRecordingStarted });

        const starting = startRecording();
        await vi.waitFor(() => expect(startPcmRecorder).toHaveBeenCalled());
        expect(isBusy.value).toBe(true);

        await stopRecording();
        grantMicrophone(recorder);
        await starting;

        expect(isRecording.value).toBe(false);
        expect(isBusy.value).toBe(false);
        expect(onRecordingStarted).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        // the devices granted after the cancel are released again
        expect(recorder.stop).toHaveBeenCalledOnce();
    });

    it("finishes once when stopped twice", async () => {
        const onRecordingStopped = vi.fn();
        const { startRecording, stopRecording, isBusy } = useAudioRecording({
            onRecordingStopped,
        });
        await startRecording();
        expect(isBusy.value).toBe(true);

        await Promise.all([stopRecording(), stopRecording()]);

        expect(onRecordingStopped).toHaveBeenCalledOnce();
        expect(recorder.stop).toHaveBeenCalledOnce();
        expect(isBusy.value).toBe(false);
    });

    it("releases the microphone when finishing fails", async () => {
        storage.getSessionChunks.mockRejectedValueOnce(new Error("db gone"));
        const onError = vi.fn();
        const { startRecording, stopRecording, isProcessing } =
            useAudioRecording({ onError });
        await startRecording();

        await expect(stopRecording()).rejects.toThrow("db gone");

        expect(recorder.stop).toHaveBeenCalledOnce();
        expect(isProcessing.value).toBe(false);
        expect(onError).toHaveBeenCalledWith("db gone");
    });
});
