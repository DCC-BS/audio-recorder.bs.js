// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
    createSession: vi.fn(async () => "session-1"),
    deleteSession: vi.fn(async () => {}),
    getSession: vi.fn(async () => ({ id: "session-1" })),
    getSessionChunks: vi.fn(async () => [new ArrayBuffer(8)]),
    storeAudioChunk: vi.fn(async () => {}),
    setSessionStatus: vi.fn(async () => {}),
}));

/** A fake PCMRecorder; `emit` plays samples into the recording. */
function fakeRecorder() {
    let listener: (data: Float32Array) => void = () => {};
    let interrupted: (() => void) | undefined;
    return {
        stream: {} as MediaStream,
        sampleRate: 48000,
        isHealthy: true,
        stop: vi.fn(async () => {}),
        pause: vi.fn(),
        resume: vi.fn(async () => {}),
        setLogger: vi.fn(),
        setOnContextSuspended: vi.fn(),
        setOnInterrupted: vi.fn((cb?: () => void) => {
            interrupted = cb;
        }),
        onPCMData: vi.fn((cb: (data: Float32Array) => void) => {
            listener = cb;
        }),
        handleVisibilityChange: vi.fn(),
        emit: (seconds: number) => listener(new Float32Array(48000 * seconds)),
        interrupt: () => interrupted?.(),
    };
}

const recorder = vi.hoisted(() => ({
    stream: {} as MediaStream,
    sampleRate: 48000,
    isHealthy: true,
    stop: vi.fn(async () => {}),
    pause: vi.fn(),
    resume: vi.fn(async () => {}),
    setLogger: vi.fn(),
    setOnContextSuspended: vi.fn(),
    setOnInterrupted: vi.fn(),
    onPCMData: vi.fn(),
    handleVisibilityChange: vi.fn(),
}));

const startPcmRecorder = vi.hoisted(() => vi.fn());

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../../src/runtime/services/audioStorage", () => ({
    // a class: the composable calls `new AudioStorageService()`
    AudioStorageService: class {
        constructor() {
            // biome-ignore lint/correctness/noConstructorReturn: hands out the shared mock
            return storage;
        }
    },
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

    it("stops a recording when onRecordingStarted asks to stop", async () => {
        const onRecordingStopped = vi.fn();
        let stopFromCallback: () => Promise<void> = async () => {};
        const recording = useAudioRecording({
            onRecordingStarted: () => {
                stopFromCallback();
            },
            onRecordingStopped,
        });
        stopFromCallback = recording.stopRecording;

        await recording.startRecording();

        expect(recording.isRecording.value).toBe(false);
        expect(recording.isBusy.value).toBe(false);
        expect(recorder.stop).toHaveBeenCalledOnce();
        expect(onRecordingStopped).not.toHaveBeenCalled();
    });
});

describe("useAudioRecording pause and resume", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        URL.createObjectURL = vi.fn(() => "blob:audio");
        Object.defineProperty(navigator, "storage", {
            configurable: true,
            value: { estimate: async () => ({ usage: 0, quota: 1 }) },
        });
    });

    it("stores the audio and releases the devices on pause", async () => {
        const first = fakeRecorder();
        startPcmRecorder.mockResolvedValueOnce(first);
        const onRecordingPaused = vi.fn();
        const r = useAudioRecording({
            pauseMode: "release",
            onRecordingPaused,
        });
        await r.startRecording();
        first.emit(2);

        await r.pauseRecording();

        expect(storage.storeAudioChunk).toHaveBeenCalledWith(
            "session-1",
            expect.any(ArrayBuffer),
            2,
        );
        expect(storage.setSessionStatus).toHaveBeenCalledWith(
            "session-1",
            "paused",
        );
        expect(first.stop).toHaveBeenCalledOnce();
        expect(r.isPaused.value).toBe(true);
        expect(r.isRecording.value).toBe(false);
        // nothing is lost when a paused page goes away
        expect(r.isBusy.value).toBe(false);
        expect(onRecordingPaused).toHaveBeenCalledWith(false);
    });

    it("opens fresh devices when resuming a released pause", async () => {
        const first = fakeRecorder();
        const second = fakeRecorder();
        startPcmRecorder
            .mockResolvedValueOnce(first)
            .mockResolvedValueOnce(second);
        const onRecordingStarted = vi.fn();
        const r = useAudioRecording({
            pauseMode: "release",
            onRecordingStarted,
        });
        await r.startRecording();
        first.emit(3);
        await r.pauseRecording();

        await r.resumeRecording();
        second.emit(2);

        expect(startPcmRecorder).toHaveBeenCalledTimes(2);
        expect(onRecordingStarted).toHaveBeenCalledTimes(2);
        expect(storage.setSessionStatus).toHaveBeenLastCalledWith(
            "session-1",
            "recording",
        );
        expect(r.isRecording.value).toBe(true);
        // pauses do not count
        expect(r.recordingTime.value).toBe(5);
    });

    it("keeps the devices open in keep mode", async () => {
        const first = fakeRecorder();
        startPcmRecorder.mockResolvedValueOnce(first);
        const r = useAudioRecording({ pauseMode: "keep" });
        await r.startRecording();
        first.emit(1);
        await r.pauseRecording();
        // samples arriving while paused are dropped
        first.emit(10);

        await r.resumeRecording();

        expect(first.pause).toHaveBeenCalledOnce();
        expect(first.resume).toHaveBeenCalledOnce();
        expect(first.stop).not.toHaveBeenCalled();
        expect(startPcmRecorder).toHaveBeenCalledOnce();
        expect(r.recordingTime.value).toBe(1);
    });

    it("replaces kept devices that stopped working", async () => {
        const first = fakeRecorder();
        const second = fakeRecorder();
        startPcmRecorder
            .mockResolvedValueOnce(first)
            .mockResolvedValueOnce(second);
        const r = useAudioRecording({ pauseMode: "keep" });
        await r.startRecording();
        await r.pauseRecording();
        first.isHealthy = false;

        await r.resumeRecording();

        expect(first.stop).toHaveBeenCalledOnce();
        expect(startPcmRecorder).toHaveBeenCalledTimes(2);
        expect(r.isRecording.value).toBe(true);
    });

    it("stays paused when the devices cannot be reopened", async () => {
        const first = fakeRecorder();
        startPcmRecorder
            .mockResolvedValueOnce(first)
            .mockRejectedValueOnce(new Error("denied"));
        const onError = vi.fn();
        const r = useAudioRecording({ pauseMode: "release", onError });
        await r.startRecording();
        await r.pauseRecording();

        await r.resumeRecording();

        expect(onError).toHaveBeenCalledOnce();
        expect(r.isPaused.value).toBe(true);
        expect(r.isStarting.value).toBe(false);
    });

    it("finishes a paused recording", async () => {
        const first = fakeRecorder();
        startPcmRecorder.mockResolvedValueOnce(first);
        const onRecordingStopped = vi.fn();
        const r = useAudioRecording({
            pauseMode: "release",
            onRecordingStopped,
        });
        await r.startRecording();
        first.emit(1);
        await r.pauseRecording();

        await r.stopRecording();

        expect(onRecordingStopped).toHaveBeenCalledOnce();
        expect(storage.deleteSession).toHaveBeenCalledWith("session-1");
        expect(r.isPaused.value).toBe(false);
    });

    it("continues a stored session instead of creating one", async () => {
        const first = fakeRecorder();
        startPcmRecorder.mockResolvedValueOnce(first);
        storage.getSession.mockResolvedValueOnce({
            id: "stored",
            duration: 90,
        } as never);
        const r = useAudioRecording();

        await r.resumeSession("stored");
        first.emit(1);

        expect(storage.createSession).not.toHaveBeenCalled();
        expect(storage.setSessionStatus).toHaveBeenCalledWith(
            "stored",
            "recording",
        );
        expect(r.currentSession.value).toBe("stored");
        expect(r.recordingTime.value).toBe(91);
    });

    it("leaves a stored session untouched when its devices fail", async () => {
        startPcmRecorder.mockRejectedValueOnce(new Error("denied"));
        storage.getSession.mockResolvedValueOnce({
            id: "stored",
            duration: 90,
        } as never);
        const r = useAudioRecording();

        await r.resumeSession("stored");

        expect(storage.deleteSession).not.toHaveBeenCalled();
        expect(storage.setSessionStatus).not.toHaveBeenCalled();
        expect(r.currentSession.value).toBeUndefined();
    });

    it("pauses on a system interruption when asked to", async () => {
        const first = fakeRecorder();
        startPcmRecorder.mockResolvedValueOnce(first);
        const onRecordingPaused = vi.fn();
        const r = useAudioRecording({
            pauseMode: "keep",
            autoPauseOnInterruption: true,
            onRecordingPaused,
        });
        await r.startRecording();

        first.interrupt();
        await vi.waitFor(() => expect(onRecordingPaused).toHaveBeenCalled());

        expect(onRecordingPaused).toHaveBeenCalledWith(true);
        expect(r.wasInterrupted.value).toBe(true);
        expect(r.isPaused.value).toBe(true);
    });
});

describe("useAudioRecording review fixes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        storage.getSession.mockImplementation(
            async () => ({ id: "session-1" }) as never,
        );
        storage.createSession.mockImplementation(async () => "session-1");
        URL.createObjectURL = vi.fn(() => "blob:audio");
        Object.defineProperty(navigator, "storage", {
            configurable: true,
            value: { estimate: async () => ({ usage: 0, quota: 1 }) },
        });
    });

    it("keeps an omitted logger as a no-op", async () => {
        const first = fakeRecorder();
        startPcmRecorder.mockResolvedValueOnce(first);
        const r = useAudioRecording({ logger: undefined, pauseMode: "keep" });
        await r.startRecording();

        expect(first.setLogger).toHaveBeenCalledWith(expect.any(Function));
        storage.setSessionStatus.mockRejectedValueOnce(new Error("db"));
        // logs the failed status write instead of throwing
        await expect(r.pauseRecording()).resolves.toBeUndefined();
    });

    it("does not delete an earlier session when a new start fails", async () => {
        const first = fakeRecorder();
        startPcmRecorder.mockResolvedValueOnce(first);
        storage.getSessionChunks.mockRejectedValueOnce(new Error("db gone"));
        const r = useAudioRecording();
        await r.startRecording();
        await expect(r.stopRecording()).rejects.toThrow("db gone");
        storage.deleteSession.mockClear();

        startPcmRecorder.mockRejectedValueOnce(new Error("denied"));
        await r.startRecording();

        // session-1 is kept as the failed finish's backup
        expect(storage.deleteSession).not.toHaveBeenCalled();
    });

    it("refuses to continue a stopped session", async () => {
        storage.getSession.mockResolvedValueOnce({
            id: "stored",
            status: "stopped",
        } as never);
        const onError = vi.fn();
        const r = useAudioRecording({ onError });

        await r.resumeSession("stored");

        expect(startPcmRecorder).not.toHaveBeenCalled();
        expect(storage.setSessionStatus).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(
            "audio-recorder.audio.errors.sessionNotResumable",
        );
    });

    it("refuses to continue a session without the default store", async () => {
        const onError = vi.fn();
        const r = useAudioRecording({ disableDefaultStore: true, onError });

        await r.resumeSession("stored");

        expect(startPcmRecorder).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(
            "audio-recorder.audio.errors.resumeNeedsStore",
        );
    });

    it("reports a pause whose audio could not be stored", async () => {
        const first = fakeRecorder();
        startPcmRecorder.mockResolvedValueOnce(first);
        storage.storeAudioChunk.mockRejectedValueOnce(new Error("quota"));
        const onRecordingPaused = vi.fn();
        const onError = vi.fn();
        const r = useAudioRecording({
            pauseMode: "keep",
            onRecordingPaused,
            onError,
        });
        await r.startRecording();
        first.emit(1);

        await r.pauseRecording();

        expect(r.pauseSaveFailed.value).toBe(true);
        expect(r.isSavingPause.value).toBe(false);
        expect(onRecordingPaused).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(
            "audio-recorder.audio.errors.pauseNotSaved",
        );
    });

    it("reports a pause whose status could not be stored", async () => {
        const first = fakeRecorder();
        startPcmRecorder.mockResolvedValueOnce(first);
        storage.setSessionStatus.mockRejectedValueOnce(new Error("db"));
        const onRecordingPaused = vi.fn();
        const r = useAudioRecording({ pauseMode: "keep", onRecordingPaused });
        await r.startRecording();

        await r.pauseRecording();

        expect(r.pauseSaveFailed.value).toBe(true);
        expect(onRecordingPaused).not.toHaveBeenCalled();
    });

    it("stays paused when stopped while the resume is stored", async () => {
        const first = fakeRecorder();
        startPcmRecorder.mockResolvedValueOnce(first);
        const r = useAudioRecording({ pauseMode: "keep" });
        await r.startRecording();
        await r.pauseRecording();

        let writeStatus: () => void = () => {};
        storage.setSessionStatus.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    writeStatus = resolve;
                }),
        );
        const resuming = r.resumeRecording();
        await vi.waitFor(() =>
            expect(storage.setSessionStatus).toHaveBeenLastCalledWith(
                "session-1",
                "recording",
            ),
        );
        // a stop while resuming cancels the resume
        await r.stopRecording();
        writeStatus();
        await resuming;

        expect(r.isRecording.value).toBe(false);
        expect(r.isPaused.value).toBe(true);
        expect(storage.setSessionStatus).toHaveBeenLastCalledWith(
            "session-1",
            "paused",
        );
    });

    it("replaces devices interrupted while resuming", async () => {
        const first = fakeRecorder();
        const second = fakeRecorder();
        startPcmRecorder
            .mockResolvedValueOnce(first)
            .mockResolvedValueOnce(second);
        const r = useAudioRecording({ pauseMode: "keep" });
        await r.startRecording();
        await r.pauseRecording();
        // the input mutes while the resume is under way
        first.resume.mockImplementationOnce(async () => {
            first.isHealthy = false;
        });

        await r.resumeRecording();

        expect(first.stop).toHaveBeenCalledOnce();
        expect(startPcmRecorder).toHaveBeenCalledTimes(2);
        expect(r.isRecording.value).toBe(true);
    });

    it("marks a delivered session stopped before deleting it", async () => {
        const first = fakeRecorder();
        startPcmRecorder.mockResolvedValueOnce(first);
        storage.deleteSession.mockRejectedValueOnce(new Error("db"));
        const r = useAudioRecording();
        await r.startRecording();
        first.emit(1);

        await r.stopRecording();

        expect(storage.setSessionStatus).toHaveBeenLastCalledWith(
            "session-1",
            "stopped",
        );
    });

    it("stays paused when the reopened input is already unusable", async () => {
        const first = fakeRecorder();
        const second = fakeRecorder();
        second.isHealthy = false;
        startPcmRecorder
            .mockResolvedValueOnce(first)
            .mockResolvedValueOnce(second);
        const onError = vi.fn();
        const r = useAudioRecording({ pauseMode: "release", onError });
        await r.startRecording();
        await r.pauseRecording();

        await r.resumeRecording();

        expect(r.isRecording.value).toBe(false);
        expect(r.isPaused.value).toBe(true);
        expect(second.stop).toHaveBeenCalledOnce();
        expect(onError).toHaveBeenCalledWith(
            "audio-recorder.audio.errors.inputUnavailable",
        );
    });

    it("logs a delivered session it can neither delete nor mark", async () => {
        const first = fakeRecorder();
        startPcmRecorder.mockResolvedValueOnce(first);
        const onRecordingStopped = vi.fn();
        const onError = vi.fn();
        const logger = vi.fn();
        const r = useAudioRecording({ onRecordingStopped, onError, logger });
        await r.startRecording();
        first.emit(1);
        storage.setSessionStatus.mockRejectedValueOnce(new Error("db"));
        storage.deleteSession.mockRejectedValueOnce(new Error("db"));

        await r.stopRecording();

        // delivered all the same, and not reported as a user error
        expect(onRecordingStopped).toHaveBeenCalledOnce();
        expect(onError).not.toHaveBeenCalled();
        expect(logger).toHaveBeenCalledWith(
            expect.stringContaining("could neither be deleted nor marked"),
        );
    });
});
