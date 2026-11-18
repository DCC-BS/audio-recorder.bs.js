import { type Ref, ref } from "vue";
import type { AudioStorageService } from "../services/audioStorage";
import type { PCMRecorder } from "./pcmRecorder";
import { isIOS } from "./platform";

/**
 * What a pause does with the devices: `release` closes them (resume may
 * prompt again), `keep` keeps them open (resume is instant), `auto` keeps
 * them on iOS and for `getStream`, releases them elsewhere.
 */
export type PauseMode = "auto" | "release" | "keep";

/** Aborts a start whose owner unmounted while it was still starting. */
export class StartCancelled extends Error {}

/** Freshly opened devices that already deliver no audio. */
export class InputUnavailable extends Error {}

/**
 * Resolves `auto` for this platform.
 *
 * @param mode - The configured mode.
 * @param externalStream - Whether the caller supplies the stream (`getStream`).
 */
export function resolvePauseMode(
    mode: PauseMode,
    externalStream: boolean,
): Exclude<PauseMode, "auto"> {
    if (mode !== "auto") {
        return mode;
    }
    return externalStream || isIOS() ? "keep" : "release";
}

/** What pause and resume need from the recording they belong to. */
export interface PauseContext {
    mode: Exclude<PauseMode, "auto">;
    storeEnabled: boolean;
    audioStorage: AudioStorageService;
    currentSession: Ref<string | undefined>;
    isRecording: Ref<boolean>;
    isStarting: Ref<boolean>;
    error: Ref<string | undefined>;
    t: (key: string) => string;
    logger: (msg: string) => void;
    onPaused: (interrupted: boolean) => void;
    onResumed: () => void;
    onStarted: (stream: MediaStream) => void;
    fail: (message: string) => void;
    deviceError: (e: unknown) => string;
    recorder: () => PCMRecorder | undefined;
    openRecorder: () => Promise<PCMRecorder>;
    releaseRecorder: () => Promise<void>;
    /** Encodes and stores the buffered samples as the next chunk. */
    appendMp3: () => Promise<void>;
    /** A chunk of this recording could not be stored. */
    chunkFailed: () => boolean;
    /** A stop is in progress. */
    isStopping: () => boolean;
    /** Clears a cancel left from an earlier start. */
    beginStart: () => void;
    /** @throws StartCancelled when the owner unmounted or stopped meanwhile. */
    ensureNotDisposed: () => void;
    isDisposed: () => boolean;
}

/**
 * Pause and resume of a running recording. A pause stores everything
 * recorded so far and marks the session `paused` in IndexedDB, so it
 * survives the page going away.
 *
 * @param ctx - The recording this belongs to.
 */
export function createPauseResume(ctx: PauseContext) {
    /** Paused; everything recorded so far is stored. */
    const isPaused = ref(false);
    /** Paused, but the audio up to the pause is still being stored. */
    const isSavingPause = ref(false);
    /** The current pause could not be stored completely; leaving is not safe. */
    const pauseSaveFailed = ref(false);
    /** The current pause was caused by the system (a call, Siri), not the user. */
    const wasInterrupted = ref(false);

    // the pause in progress; stop and resume wait for it
    let pendingPause: Promise<void> | undefined;
    // the resume in progress; unmount waits for it before the final status
    let pendingResume: Promise<void> | undefined;

    /** Settles once a pause or resume in progress is done. */
    async function settled(): Promise<void> {
        await Promise.allSettled([pendingPause, pendingResume]);
    }

    function pause(interrupted: boolean): Promise<void> {
        if (pendingPause) {
            return pendingPause;
        }
        if (!ctx.isRecording.value) {
            return Promise.resolve();
        }

        pendingPause = doPause(interrupted).finally(() => {
            pendingPause = undefined;
        });
        return pendingPause;
    }

    async function doPause(interrupted: boolean): Promise<void> {
        ctx.isRecording.value = false;
        isPaused.value = true;
        isSavingPause.value = true;
        pauseSaveFailed.value = false;
        wasInterrupted.value = interrupted;

        const sessionId = ctx.currentSession.value;
        // marked right away: the encoding below can take a while, and a
        // page closed meanwhile should still leave a paused session
        const marked: Promise<boolean> =
            sessionId && ctx.storeEnabled
                ? ctx.audioStorage.setSessionStatus(sessionId, "paused").then(
                      () => true,
                      (e) => {
                          ctx.logger(`Storing the pause failed: ${e}`);
                          return false;
                      },
                  )
                : Promise.resolve(true);

        const stored = ctx.appendMp3();
        if (ctx.mode === "release") {
            await ctx.releaseRecorder();
        } else {
            // resume replaces the devices if they stopped working
            ctx.recorder()?.pause();
        }

        try {
            await stored;
        } catch {
            // recorded in chunkFailed, checked below
        }
        const statusStored = await marked;
        isSavingPause.value = false;

        // without the paused status the session still shows up as
        // interrupted, so what was stored stays recoverable
        if (ctx.chunkFailed() || !statusStored) {
            // incomplete audio must not pass as a saved pause after a reload;
            // as an interrupted session it stays recoverable
            if (ctx.chunkFailed() && statusStored && sessionId) {
                await ctx.audioStorage
                    .setSessionStatus(sessionId, "recording")
                    .catch(() => {});
            }
            pauseSaveFailed.value = true;
            ctx.fail(ctx.t("audio-recorder.audio.errors.pauseNotSaved"));
            return;
        }

        ctx.onPaused(interrupted);
    }

    /**
     * Continues a paused recording. Opens the devices again when they were
     * released (which may show a permission prompt); a failure is reported
     * through `error` and the recording stays paused.
     */
    function resume(): Promise<void> {
        if (!pendingResume) {
            pendingResume = doResume().finally(() => {
                pendingResume = undefined;
            });
        }
        return pendingResume;
    }

    async function doResume(): Promise<void> {
        await pendingPause;
        if (!isPaused.value || ctx.isStarting.value || ctx.isStopping()) {
            return;
        }

        ctx.isStarting.value = true;
        ctx.beginStart();
        ctx.error.value = "";
        // lets a cancel or failure put the session back to paused
        let statusChanged = false;
        try {
            let resumed = false;
            const kept = ctx.recorder();
            if (kept?.isHealthy) {
                try {
                    await kept.resume();
                    resumed = true;
                } catch (e) {
                    ctx.logger(`Kept devices could not resume: ${e}`);
                }
            }
            if (!resumed) {
                await reopenRecorder();
            }
            ctx.ensureNotDisposed();

            const sessionId = ctx.currentSession.value;
            if (sessionId && ctx.storeEnabled) {
                await ctx.audioStorage.setSessionStatus(sessionId, "recording");
                statusChanged = true;
            }
            // unmounted or stopped while the status was written
            ctx.ensureNotDisposed();

            // an interruption during the awaits above went unnoticed
            if (!ctx.recorder()?.isHealthy) {
                await reopenRecorder();
                ctx.ensureNotDisposed();
            }

            isPaused.value = false;
            wasInterrupted.value = false;
            ctx.isRecording.value = true;
        } catch (e) {
            const sessionId = ctx.currentSession.value;
            // once unmounted, unmount writes the final status and lets go
            // of the session; another page may own it by the time this runs.
            // An incomplete pause was left as "recording" and stays so.
            if (statusChanged && sessionId && !ctx.isDisposed()) {
                await ctx.audioStorage
                    .setSessionStatus(
                        sessionId,
                        pauseSaveFailed.value ? "recording" : "paused",
                    )
                    .catch(() => {});
            }
            // stays paused. A recorder opened half way is of no use, and
            // after a cancel nobody would ever close it
            const recorder = ctx.recorder();
            if (
                recorder &&
                (ctx.isDisposed() ||
                    e instanceof StartCancelled ||
                    ctx.mode === "release" ||
                    !recorder.isHealthy)
            ) {
                await ctx.releaseRecorder();
            } else {
                recorder?.pause();
            }
            // reported last: a throwing onError must not skip the cleanup
            if (!(e instanceof StartCancelled)) {
                console.error(e);
                ctx.fail(
                    e instanceof InputUnavailable
                        ? e.message
                        : ctx.deviceError(e),
                );
            }
            return;
        } finally {
            ctx.isStarting.value = false;
        }
        try {
            ctx.onResumed();
        } catch (e) {
            ctx.logger(`onRecordingResumed failed: ${e}`);
        }
    }

    /** Opens fresh devices; throws if their input is already unusable. */
    async function reopenRecorder(): Promise<void> {
        await ctx.releaseRecorder();
        const recorder = await ctx.openRecorder();
        ctx.ensureNotDisposed();
        // its input may already be taken away again (a call still going
        // on); recording would only capture silence
        if (!recorder.isHealthy) {
            throw new InputUnavailable(
                ctx.t("audio-recorder.audio.errors.inputUnavailable"),
            );
        }
        ctx.onStarted(recorder.stream);
    }

    function reset(): void {
        wasInterrupted.value = false;
        isSavingPause.value = false;
        pauseSaveFailed.value = false;
    }

    return {
        isPaused,
        isSavingPause,
        pauseSaveFailed,
        wasInterrupted,
        pause,
        resume,
        settled,
        reset,
    };
}
