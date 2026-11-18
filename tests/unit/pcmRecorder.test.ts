// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { PCMRecorder } from "../../src/runtime/utils/pcmRecorder";

/** A track that can be stopped and muted. */
function fakeTrack() {
    return {
        readyState: "live" as MediaStreamTrackState,
        muted: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        stop: vi.fn(),
    };
}

/** Builds a recorder around fakes; `send` plays a worklet message. */
function setup(tracks: ReturnType<typeof fakeTrack>[]) {
    const stream = {
        getAudioTracks: () => [...tracks],
        getTracks: () => [...tracks],
    };
    const port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(),
        close: vi.fn(),
    };
    const context = {
        state: "running",
        sampleRate: 48000,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        resume: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
    };
    const worklet = { port, disconnect: vi.fn() };
    const recorder = new PCMRecorder(
        stream as unknown as MediaStream,
        context as unknown as AudioContext,
        worklet as unknown as AudioWorkletNode,
        { disconnect: vi.fn() } as unknown as MediaStreamAudioSourceNode,
        48000,
        false,
        tracks[0] as unknown as MediaStreamTrack,
    );
    const send = (data: unknown) => port.onmessage?.({ data });
    return { recorder, port, send, tracks };
}

describe("PCMRecorder.isHealthy", () => {
    it("follows the bound track, not any live one", () => {
        const bound = fakeTrack();
        const other = fakeTrack();
        const { recorder } = setup([bound, other]);
        expect(recorder.isHealthy).toBe(true);

        bound.readyState = "ended";

        expect(recorder.isHealthy).toBe(false);
    });

    it("notices the bound track being removed from the stream", () => {
        const bound = fakeTrack();
        const other = fakeTrack();
        const tracks = [bound, other];
        const { recorder } = setup(tracks);

        // still live, but no longer part of the stream
        tracks.splice(0, 1);

        expect(recorder.isHealthy).toBe(false);
    });
});

describe("PCMRecorder pause and resume", () => {
    it("resumes only after the worklet confirmed the pause", async () => {
        const { recorder, port, send } = setup([fakeTrack()]);
        recorder.pause();
        expect(port.postMessage).toHaveBeenLastCalledWith({ type: "pause" });

        let resumed = false;
        const resuming = recorder.resume().then(() => {
            resumed = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        // no "resume" sent while blocks from before the pause may be queued
        expect(port.postMessage).not.toHaveBeenCalledWith({ type: "resume" });

        send({ type: "paused" });
        await resuming;

        expect(resumed).toBe(true);
        expect(port.postMessage).toHaveBeenCalledWith({ type: "resume" });
    });

    it("does not wait forever for a worklet that never answers", async () => {
        vi.useFakeTimers();
        try {
            const { recorder, port } = setup([fakeTrack()]);
            recorder.pause();

            const resuming = recorder.resume();
            await vi.advanceTimersByTimeAsync(600);
            expect(port.postMessage).toHaveBeenCalledWith({ type: "resume" });
            await resuming;
        } finally {
            vi.useRealTimers();
        }
    });
});
