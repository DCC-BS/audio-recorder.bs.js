import { computed, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { AudioStorageService } from "../services/audioStorage";
import { type AudioSessionStatus, isResumable } from "../services/db";
import {
    checkMicrophoneAvailability,
    handleMicrophoneError,
} from "../utils/microphone";
import {
    assertHealthy,
    createPauseResume,
    InputUnavailable,
    type PauseMode,
    resolvePauseMode,
    StartCancelled,
} from "../utils/pauseResume";
import { toPcmData } from "../utils/pcm";
import { type PCMRecorder, startPcmRecorder } from "../utils/pcmRecorder";
import { isIOS } from "../utils/platform";
import { acquireSessionLock } from "../utils/sessionLock";
import { useFFmpeg } from "./useFFmpeg";

export type { PauseMode } from "../utils/pauseResume";

/**
 * Options for audio recording
 * @property onRecordingStarted - Called whenever recording starts on fresh devices: on start, on resuming a stored session, and on a resume that had to open the devices again. Provides the MediaStream
 * @property onRecordingStopped - Callback when recording stops with the audio Blob and object URL
 * @property onRecordingPaused - Callback once a pause is stored; `interrupted` tells whether the system (a call, Siri) caused it
 * @property onRecordingResumed - Callback when a paused recording continues
 * @property onError - Callback when an error occurs during recording
 * @property storeToDbInterval - Interval in seconds to store audio chunks to IndexedDB (default: 30)
 * @property onStore - Callback when an MP3 chunk is created during recording (fires every storeToDbInterval seconds and on pause)
 * @property logger - Custom logging function for debugging
 * @property disableDefaultStore - Disable the default IndexedDB storage. Useful when handling storage yourself via the onStore callback (default: false). Pausing still works, but nothing survives the page going away
 * @property getStream - Supplies the stream to record instead of the microphone, e.g. a mix of microphone and screen audio. Called on every start; the stream's tracks are not stopped by the recorder, the caller owns them
 * @property pauseMode - What a pause does with the devices (default: "auto"), see {@link PauseMode}
 * @property autoPauseOnInterruption - Pause instead of recording silence when the system takes the microphone away, e.g. for a phone call (default: true on iOS, false elsewhere)
 * @property sessionSource - Free-form tag stored with the session, e.g. to tell which recorder should resume it
 */
export type RecordingOptions = {
    onRecordingStarted?: (stream: MediaStream) => void;
    onRecordingStopped?: (audioBlob: Blob, audioUrl: string) => void;
    onRecordingPaused?: (interrupted: boolean) => void;
    onRecordingResumed?: () => void;
    onError?: (error: string) => void;
    storeToDbInterval?: number;
    onStore?: (mp3Blob: Blob) => void | Promise<void>;
    logger?: (msg: string) => void;
    disableDefaultStore?: boolean;
    getStream?: () => Promise<MediaStream>;
    pauseMode?: PauseMode;
    autoPauseOnInterruption?: boolean;
    sessionSource?: string;
};

const optionsDefault: Required<
    Omit<
        RecordingOptions,
        "getStream" | "autoPauseOnInterruption" | "sessionSource"
    >
> = {
    onRecordingStarted: () => {},
    onRecordingStopped: () => {},
    onRecordingPaused: () => {},
    onRecordingResumed: () => {},
    onError: () => {},
    storeToDbInterval: 30, // 30 seconds
    onStore: () => {},
    logger: (_: string) => {},
    disableDefaultStore: false,
    pauseMode: "auto",
};

/**
 * Composable for audio recording using MediaRecorder API
 * Handles microphone access, recording state, pausing and audio storage
 *
 * @param options - Configuration options for recording
 * @returns Object containing recording state, controls, and recorded audio data
 *
 * @example
 * ```
 * const stream = ref<MediaStream>();
 * const {
 *     isRecording,
 *     isPaused,
 *     startRecording,
 *     pauseRecording,
 *     resumeRecording,
 *     stopRecording,
 *     recordingTime,
 *     error,
 *     audioUrl,
 * } = useAudioRecording({
 *     onRecordingStarted: (s: MediaStream) => {
 *         stream.value = s;
 *     },
 * });
 * ```
 */
export function useAudioRecording(options: RecordingOptions = {}) {
    // an option passed as `undefined` (e.g. an omitted component prop)
    // keeps its default instead of overriding it
    const defined = Object.fromEntries(
        Object.entries(options).filter(([, value]) => value !== undefined),
    ) as RecordingOptions;
    const opt = { ...optionsDefault, ...defined };
    const { t } = useI18n();
    const { concatMp3, pcmToMp3 } = useFFmpeg(opt.logger);

    const pauseMode = resolvePauseMode(opt.pauseMode, Boolean(opt.getStream));
    const autoPauseOnInterruption = opt.autoPauseOnInterruption ?? isIOS();

    /** Capturing audio right now. */
    const isRecording = ref(false);
    /** Between the start request and the first sample: devices, permission prompt, session. Also set while resuming. */
    const isStarting = ref(false);
    const isProcessing = ref(false);
    /**
     * Starting, recording, finishing or storing a pause: audio would be lost
     * if the page went away now. A stored pause is not busy.
     */
    const isBusy = computed(
        () =>
            isStarting.value ||
            isRecording.value ||
            isProcessing.value ||
            isSavingPause.value,
    );
    const wasSuspended = ref(false);
    /** Seconds recorded in this session, pauses not counted. */
    const recordingTime = ref(0);

    const error = ref<string>();
    const audioBlob = ref<Blob>();
    const audioUrl = ref<string>();

    const audioStorage = new AudioStorageService();
    const currentSession = ref<string>();

    const pausing = createPauseResume({
        mode: pauseMode,
        storeEnabled: !opt.disableDefaultStore,
        audioStorage,
        currentSession,
        isRecording,
        isStarting,
        error,
        t,
        logger: opt.logger,
        onPaused: (interrupted) => opt.onRecordingPaused(interrupted),
        onResumed: () => opt.onRecordingResumed(),
        onStarted: (stream) => opt.onRecordingStarted(stream),
        fail,
        deviceError,
        recorder: () => pcmRecorder,
        openRecorder,
        releaseRecorder,
        appendMp3,
        chunkFailed: () => chunkFailed,
        isStopping: () => Boolean(pendingStop),
        beginStart: () => {
            startCancelled = false;
        },
        ensureNotDisposed,
        isDisposed: () => disposed,
    });
    const { isPaused, isSavingPause, pauseSaveFailed, wasInterrupted } =
        pausing;
    /** Holds a session: starting, recording, paused or finishing. */
    const isActive = computed(
        () =>
            isStarting.value ||
            isRecording.value ||
            isPaused.value ||
            isProcessing.value,
    );

    let pcmRecorder: PCMRecorder | undefined;

    let pcmArrays: Float32Array[] = [];
    let totalSamples = 0;
    // sample rate of the buffered samples
    let bufferRate = 0;
    // exact seconds behind recordingTime
    let elapsed = 0;
    // ends this page's ownership of the current session (see sessionLock)
    let releaseLock: (() => void) | undefined;

    const handleVisibilityChange = async () => {
        if (pcmRecorder && isRecording.value) {
            await pcmRecorder.handleVisibilityChange();
        }
    };

    // once the owner is gone a finished recording can no longer be handed
    // over, so it must stay in storage
    let disposed = false;
    // stopRecording was called while the recording was still starting
    let startCancelled = false;
    // the stop in progress; a second stop joins it instead of finishing twice
    let pendingStop: Promise<void> | undefined;
    // a starting resume of a stored session began writing its status; until
    // then it has changed nothing and holds the lock only to open devices
    let startWriting = false;

    onUnmounted(() => {
        disposed = true;
        document.removeEventListener(
            "visibilitychange",
            handleVisibilityChange,
        );

        // a stop in progress finishes and lets go of the session itself
        if (pendingStop) {
            return;
        }

        // still opening devices (a picker may stay open indefinitely): the
        // start writes nothing once cancelled, so the session is free now
        // (an in-place resume of a paused recording is handled below)
        if (isStarting.value && !isPaused.value && !startWriting) {
            releaseOwnership();
        }

        const sessionId = currentSession.value;
        // a pause that is fully stored needs no further write: let go of
        // the session at once, so a page shown next lists it as paused
        if (
            isPaused.value &&
            !isSavingPause.value &&
            !isStarting.value &&
            pausing.storedStatus() === "paused"
        ) {
            void releaseRecorder();
            releaseOwnership();
            return;
        }
        if ((isRecording.value || isPaused.value) && sessionId) {
            // keep what was recorded since the last store and leave the
            // session paused, ready to be resumed
            // only a running recording pauses now; an already paused one
            // (e.g. its resume was cut short) keeps its pause time
            const wasRecording = isRecording.value;
            const stored = wasRecording ? appendMp3() : appendQueue;
            isRecording.value = false;
            const paused = pausing.writesSettled();
            void releaseRecorder();
            Promise.all([stored, paused])
                .catch(() => {})
                // incomplete audio stays "recording" (interrupted), so it
                // does not pass as a saved pause
                .then(() =>
                    audioStorage.setSessionStatus(
                        sessionId,
                        pausing.storedStatus(),
                        !wasRecording,
                    ),
                )
                .catch(() => {})
                .finally(releaseOwnership);
            return;
        }

        if (pcmRecorder) {
            void releaseRecorder();
        }
    });

    /**
     * Reports a failure through `error` and the onError callback.
     *
     * @param message - What went wrong.
     */
    function fail(message: string): void {
        error.value = message;
        opt.onError(message);
    }

    function startRecording(): Promise<void> {
        return begin();
    }

    /**
     * Continues a stored session: one paused earlier, or one cut off by a
     * crash or a closed tab. New audio is appended to it.
     *
     * @param sessionId - The stored session to continue.
     */
    async function resumeSession(sessionId: string): Promise<void> {
        // new audio would bypass IndexedDB, and finishing joins only what
        // is stored there: the result would silently lack it
        if (opt.disableDefaultStore) {
            fail(t("audio-recorder.audio.errors.resumeNeedsStore"));
            return;
        }
        await begin(sessionId);
    }

    async function begin(resumeId?: string): Promise<void> {
        // an active recorder owns the session and the buffers; a second
        // start would record twice into them
        if (isActive.value) {
            return;
        }
        isStarting.value = true;
        startCancelled = false;
        startWriting = false;
        try {
            await start(resumeId);
        } finally {
            isStarting.value = false;
        }
    }

    /**
     * Ends a start that was cancelled while it was awaiting something (a
     * permission prompt, the screen picker): its owner unmounted, or
     * stopRecording was called. Nothing would ever stop the recorder it is
     * about to create.
     *
     * @throws StartCancelled when the start was cancelled.
     */
    function ensureNotDisposed(): void {
        if (disposed || startCancelled) {
            throw new StartCancelled();
        }
    }

    function deviceError(e: unknown): string {
        // getStream errors are the caller's (e.g. a cancelled screen
        // picker) and must not be reported as microphone problems
        return opt.getStream
            ? (e as Error)?.message || "Recording could not be started"
            : handleMicrophoneError(e as Error);
    }

    async function start(resumeId?: string) {
        // a supplied stream need not involve a microphone at all
        if (!opt.getStream) {
            const availabilityResult = await checkMicrophoneAvailability();
            if (disposed || startCancelled) {
                return;
            }
            if (!availabilityResult.isAvailable) {
                fail(availabilityResult.message || "Microphone not available");
                return;
            }
        }

        resetRecording();
        requestPersistentStorage();

        // a session left from an earlier recording (e.g. a failed finish)
        // is not this start's to clean up
        currentSession.value = undefined;
        // the session this start created, the only one it may delete
        let createdId: string | undefined;
        // lets a failure put a resumed session back to its stored status
        let resumedStatusChanged = false;
        let resumedFrom: AudioSessionStatus = "paused";
        let openingDevices = false;

        try {
            if (resumeId) {
                releaseLock = await acquireSessionLock(resumeId);
                if (!releaseLock) {
                    fail(t("audio-recorder.audio.errors.sessionInUse"));
                    return;
                }
                const session = await audioStorage.getSession(resumeId);
                if (!session) {
                    throw new Error(`Session with ID ${resumeId} not found`);
                }
                // a stopped session is a delivered recording's backup
                if (!isResumable(session)) {
                    throw new Error(
                        t("audio-recorder.audio.errors.sessionNotResumable"),
                    );
                }
                currentSession.value = resumeId;
                resumedFrom = session.status ?? "recording";
                elapsed = session.duration ?? 0;
                recordingTime.value = Math.floor(elapsed);
            }
            ensureNotDisposed();

            openingDevices = true;
            const recorder = await openRecorder();
            openingDevices = false;
            if (resumeId) {
                assertHealthy(recorder, t);
            }

            if (resumeId) {
                ensureNotDisposed();
                startWriting = true;
                await audioStorage.setSessionStatus(resumeId, "recording");
                resumedStatusChanged = true;
            } else {
                const id = await audioStorage.createSession(
                    `${t("audio-recorder.audio.newRecording", { date: new Date().toLocaleString() })}`,
                    recorder.sampleRate,
                    1,
                    opt.sessionSource,
                );
                createdId = id;
                currentSession.value = id;
                releaseLock = (await acquireSessionLock(id)) ?? (() => {});
            }
            ensureNotDisposed();
            // the input may have ended while the status was written
            if (resumeId) {
                assertHealthy(recorder, t);
            }

            opt.onRecordingStarted(recorder.stream);
            // the callback may already have asked to stop
            ensureNotDisposed();

            isRecording.value = true;
            logStorageUsage();
        } catch (e) {
            try {
                if (resumeId) {
                    if (resumedStatusChanged) {
                        await audioStorage.setSessionStatus(
                            resumeId,
                            resumedFrom,
                            true,
                        );
                    }
                } else if (createdId) {
                    await audioStorage.deleteSession(createdId);
                }
            } catch (err) {
                console.error(
                    "Error cleaning up session after failed start:",
                    err,
                );
            }
            currentSession.value = undefined;
            releaseOwnership();

            if (pcmRecorder) {
                await releaseRecorder();
            }

            // reported after the cleanup, which a throwing onError would
            // otherwise skip; a cancelled start has nobody left to tell
            if (!(e instanceof StartCancelled)) {
                console.error(e);
                fail(
                    e instanceof InputUnavailable
                        ? e.message
                        : openingDevices || !resumeId
                          ? deviceError(e)
                          : (e as Error)?.message ||
                            "Recording could not be resumed",
                );
            }
        }
    }

    async function openRecorder(): Promise<PCMRecorder> {
        const externalStream = opt.getStream
            ? await opt.getStream()
            : undefined;
        ensureNotDisposed();
        const recorder = await startPcmRecorder(externalStream);
        pcmRecorder = recorder;
        ensureNotDisposed();

        recorder.setLogger(opt.logger);
        recorder.setOnContextSuspended(() => {
            wasSuspended.value = true;
            opt.logger("AudioContext was suspended during recording");
        });
        if (autoPauseOnInterruption) {
            recorder.setOnInterrupted(() => {
                if (isRecording.value && pcmRecorder === recorder) {
                    opt.logger("Pausing: the system interrupted the recording");
                    void pausing.pause(true);
                }
            });
        }

        document.addEventListener("visibilitychange", handleVisibilityChange);

        const sampleRate = recorder.sampleRate;
        recorder.onPCMData((pcmData: Float32Array) => {
            // samples still arrive while paused (devices kept) and until a
            // released recorder is torn down; none of them are recorded
            if (!isRecording.value || pcmRecorder !== recorder) {
                return;
            }

            pcmArrays.push(pcmData);
            bufferRate = sampleRate;
            totalSamples += pcmData.length;
            elapsed += pcmData.length / sampleRate;
            recordingTime.value = Math.floor(elapsed);

            if (totalSamples / sampleRate >= opt.storeToDbInterval) {
                // nobody awaits this listener, so failures end here
                appendMp3().catch((e) => {
                    opt.logger(`Storing an audio chunk failed: ${e}`);
                });
            }
        });

        return recorder;
    }

    /** Best effort: asks the browser not to evict stored recordings. */
    function requestPersistentStorage(): void {
        navigator.storage?.persist?.().catch(() => {});
    }

    function logStorageUsage(): void {
        if (!import.meta.env.DEV || !navigator.storage?.estimate) {
            return;
        }
        navigator.storage.estimate().then((estimate) => {
            if (!estimate.quota || !estimate.usage) return;
            const usageMB = (estimate.usage / (1024 * 1024)).toFixed(2);
            const quotaMB = (estimate.quota / (1024 * 1024)).toFixed(2);
            opt.logger(
                `${recordingTime.value}: Using ${usageMB} MB out of ${quotaMB} MB`,
            );
        });
    }

    let appendQueue: Promise<void> = Promise.resolve();
    // the queue recovers from a failed chunk so later ones are still
    // stored; the failure is kept for stopRecording to report
    // a flag, not the reason: a rejection may carry none
    let chunkFailed = false;

    /**
     * Encodes the buffered samples and stores them as the next chunk.
     *
     * The samples, session and sample rate are taken right away; only the
     * encoding waits its turn. Chunks are therefore stored in recording
     * order, the call made by stopRecording settles after every earlier
     * one, and a queued call never depends on a recorder that has been torn
     * down in the meantime.
     *
     * @returns Settles once this chunk (and every earlier one) is stored.
     */
    function appendMp3(): Promise<void> {
        // stopping right after a periodic store leaves nothing to encode,
        // and FFmpeg fails on empty input
        if (pcmArrays.length === 0 || !currentSession.value) {
            return appendQueue;
        }

        const data = toPcmData(pcmArrays);
        const sampleRate = bufferRate;
        const duration = totalSamples / sampleRate;
        const sessionId = currentSession.value;
        totalSamples = 0;
        pcmArrays = [];

        const next = appendQueue.then(() =>
            storeChunk(data, sampleRate, duration, sessionId),
        );
        appendQueue = next.catch(() => {
            chunkFailed = true;
        });
        return next;
    }

    async function storeChunk(
        data: Float32Array,
        sampleRate: number,
        duration: number,
        sessionId: string,
    ): Promise<void> {
        const mp3Blob = await pcmToMp3(data, sampleRate, 1);

        await opt.onStore(mp3Blob);

        if (opt.disableDefaultStore) {
            return;
        }

        await audioStorage
            .storeAudioChunk(sessionId, await mp3Blob.arrayBuffer(), duration)
            .catch((e) => {
                console.error("Error storing audio chunk:", e);
                throw e;
            });
    }

    /** Stores everything recorded so far, then pauses (see `pauseMode`). */
    function pauseRecording(): Promise<void> {
        return pausing.pause(false);
    }

    /**
     * Stops the recording and hands the audio to `onRecordingStopped`.
     * A paused recording is finished the same way.
     *
     * - While the recording is still starting, the start is cancelled: no
     *   recording is made and nothing is reported.
     * - Without a recording (never started, or already finished) it does
     *   nothing, so callers may stop unconditionally (e.g. when a dialog
     *   closes).
     * - A second call while the first is still finishing joins it.
     *
     * @throws Error when the recording could not be finished; it is also
     *   reported through `error` and `onError`.
     */
    function stopRecording(): Promise<void> {
        if (pendingStop) {
            return pendingStop;
        }
        if (isStarting.value) {
            startCancelled = true;
            return Promise.resolve();
        }
        if (!isRecording.value && !isPaused.value && !pcmRecorder) {
            return Promise.resolve();
        }

        pendingStop = pausing
            .settled()
            .then(finishRecording)
            .finally(() => {
                pendingStop = undefined;
            });
        return pendingStop;
    }

    async function finishRecording(): Promise<void> {
        isRecording.value = false;
        isPaused.value = false;
        wasInterrupted.value = false;
        isProcessing.value = true;
        const sessionId = currentSession.value;
        // set once the stored copy is gone or handed over
        let settled = false;

        // a failure must not leave isProcessing set: callers gate new
        // recordings on it
        try {
            // appendMp3 takes the samples right away, so the devices are
            // released even when encoding that last chunk fails
            const stored = appendMp3();
            await releaseRecorder();
            await stored;

            // a gap in the middle must not pass as a complete recording;
            // what was stored stays recoverable
            if (chunkFailed) {
                throw new Error(
                    "Part of the recording could not be stored; the rest is kept among the abandoned recordings",
                );
            }

            if (!sessionId) {
                throw new Error("No active session for recording");
            }

            const session = await audioStorage.getSession(sessionId);
            if (!session) {
                throw new Error(`Session with ID ${sessionId} not found`);
            }

            const buffers = await audioStorage.getSessionChunks(sessionId);
            // stopped before any audio arrived: nothing worth keeping
            if (buffers.length === 0) {
                await audioStorage.deleteSession(sessionId);
                settled = true;
                throw new Error("Nothing was recorded");
            }
            const mp3Blob = await concatMp3(buffers);

            // nobody is left to receive it: keep it recoverable instead.
            // Nothing is awaited from here to the hand-over, so the owner
            // cannot go away in between.
            if (disposed) {
                return;
            }

            audioBlob.value = mp3Blob;
            audioUrl.value = URL.createObjectURL(mp3Blob);
            opt.onRecordingStopped(audioBlob.value, audioUrl.value);
            settled = true;

            // marked stopped first, so a failed delete leaves a backup,
            // not something that looks resumable
            const markedStopped = await audioStorage
                .setSessionStatus(sessionId, "stopped")
                .then(
                    () => true,
                    () => false,
                );
            await audioStorage.deleteSession(sessionId).catch((e) => {
                console.error("Error deleting the delivered session:", e);
                // already delivered: log rather than report to the user
                if (!markedStopped) {
                    opt.logger(
                        `The delivered session ${sessionId} could neither be deleted nor marked stopped and may be offered as resumable: ${e}`,
                    );
                }
            });
        } catch (e) {
            fail((e as Error)?.message || "Recording could not be finished");
            throw e;
        } finally {
            if (!settled && sessionId) {
                try {
                    await audioStorage.setSessionStatus(sessionId, "stopped");
                } catch {}
            }
            releaseOwnership();
            isProcessing.value = false;
        }
    }

    async function releaseRecorder(): Promise<void> {
        document.removeEventListener(
            "visibilitychange",
            handleVisibilityChange,
        );

        const recorder = pcmRecorder;
        if (!recorder) {
            return;
        }
        pcmRecorder = undefined;

        try {
            await recorder.stop();
        } catch (e) {
            console.error("Error releasing the recorder:", e);
        }
    }

    /** Lets other pages resume the current session again. */
    function releaseOwnership(): void {
        releaseLock?.();
        releaseLock = undefined;
    }

    function resetRecording(): void {
        audioBlob.value = undefined;
        audioUrl.value = "";
        error.value = "";
        pcmArrays = [];
        totalSamples = 0;
        elapsed = 0;
        recordingTime.value = 0;
        chunkFailed = false;
        wasSuspended.value = false;
        pausing.reset();
        pcmRecorder = undefined;
    }

    return {
        isRecording,
        isStarting,
        isProcessing,
        isPaused,
        isSavingPause,
        pauseSaveFailed,
        isBusy,
        isActive,
        recordingTime,
        startRecording,
        pauseRecording,
        resumeRecording: pausing.resume,
        resumeSession,
        stopRecording,
        audioBlob,
        audioUrl,
        currentSession,
        resetRecording,
        error,
        wasSuspended,
        wasInterrupted,
    };
}
