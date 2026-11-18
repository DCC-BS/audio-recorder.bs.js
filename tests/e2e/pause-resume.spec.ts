import { expect, type Page, test } from "@playwright/test";
import local from "../../src/runtime/lang/en.json" with { type: "json" };
import { countStored, countStoredChunks } from "./storage";

const audio = local["audio-recorder"].audio;

/** Seconds shown on the recorder's clock. */
async function shownSeconds(page: Page): Promise<number> {
    const text = (await page.locator(".recording-time").textContent()) ?? "";
    const [minutes = "0", seconds = "0"] = text.trim().split(":");
    return Number(minutes) * 60 + Number(seconds);
}

test.describe("Pause and resume", () => {
    test("pauses, resumes and finishes a recording", async ({ page }) => {
        // two ffmpeg-bound steps (first chunk, final join) do not reliably
        // fit the default 30s on a cold CI runner
        test.setTimeout(90_000);
        await page.goto("/");
        await page.getByRole("button", { name: audio.startRecording }).click();
        await expect(page.getByText(audio.recordingInProgress)).toBeVisible();
        await expect.poll(() => shownSeconds(page)).toBeGreaterThanOrEqual(2);

        await page.getByRole("button", { name: audio.pauseRecording }).click();
        await expect(page.getByText(audio.recordingPaused)).toBeVisible();
        // the first pause encodes the first chunk, which loads ffmpeg.wasm
        await expect(page.getByText(audio.pausedSafely)).toBeVisible({
            timeout: 30_000,
        });

        // the clock stands still while paused
        const atPause = await shownSeconds(page);
        await page.waitForTimeout(2000);
        expect(await shownSeconds(page)).toBe(atPause);

        await page.getByRole("button", { name: audio.resumeRecording }).click();
        await expect(page.getByText(audio.recordingInProgress)).toBeVisible();
        await expect
            .poll(() => shownSeconds(page))
            .toBeGreaterThanOrEqual(atPause + 1);

        await page.getByRole("button", { name: audio.stopRecording }).click();
        await expect(page.getByText(audio.recordingComplete)).toBeVisible({
            timeout: 20000,
        });

        // the delivered recording is not left behind; wait for the cleanup
        // to finish, a reload would cut it off
        await expect
            .poll(() => countStored(page, "audioSessions"), { timeout: 15_000 })
            .toBe(0);
        await page.reload();
        await expect(page.getByText(audio.startRecording)).toBeVisible();
        await expect(page.locator(".session-status")).toHaveCount(0);
    });

    test("continues a paused recording after a reload", async ({ page }) => {
        // two ffmpeg-bound steps (first chunk, final join) plus a recorded
        // stretch after the reload do not fit the default 30s
        test.setTimeout(90_000);
        await page.goto("/");
        await page.getByRole("button", { name: audio.startRecording }).click();
        await expect.poll(() => shownSeconds(page)).toBeGreaterThanOrEqual(2);
        await page.getByRole("button", { name: audio.pauseRecording }).click();
        // only once stored is the pause safe from a reload
        // the first pause encodes the first chunk, which loads ffmpeg.wasm
        await expect(page.getByText(audio.pausedSafely)).toBeVisible({
            timeout: 30_000,
        });
        const atPause = await shownSeconds(page);

        await page.reload();
        await expect(page.locator(".session-status")).toHaveText(
            "Status: paused",
        );
        await page.getByRole("button", { name: "Continue" }).click();
        await page
            .getByRole("button", { name: audio.continueRecording })
            .click();

        await expect(page.getByText(audio.recordingInProgress)).toBeVisible();
        // the clock carries on from the stored audio
        expect(await shownSeconds(page)).toBeGreaterThanOrEqual(atPause - 1);
        // record a known stretch after the reload
        // the clock resumes from the stored duration, up to a second below
        // the shown one, so this can take ~4s of capture plus startup
        await expect
            .poll(() => shownSeconds(page), { timeout: 15_000 })
            .toBeGreaterThanOrEqual(atPause + 3);

        await page.getByRole("button", { name: audio.stopRecording }).click();
        await expect(page.getByText(audio.recordingComplete)).toBeVisible({
            timeout: 20000,
        });
        const duration = await page.locator("audio").evaluate(
            (el: HTMLAudioElement) =>
                new Promise<number>((resolve) => {
                    if (el.readyState >= 1) resolve(el.duration);
                    el.addEventListener("loadedmetadata", () =>
                        resolve(el.duration),
                    );
                }),
        );
        // both parts are in the result: the stretch after the reload too,
        // with a second of slack for clock rounding and encoding
        expect(duration).toBeGreaterThanOrEqual(atPause + 2);
    });

    test("lists an interrupted recording as resumable", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: audio.startRecording }).click();
        // a chunk must be stored before the cut for anything to survive
        // the first chunk loads ffmpeg.wasm, as in external-stream.spec.ts
        await expect
            .poll(() => countStoredChunks(page), { timeout: 15_000 })
            .toBeGreaterThan(0);

        // a reload mid-recording stands in for a crash or a closed tab
        await page.reload();
        await expect(page.locator(".session-status").first()).toBeVisible();
        await page.getByRole("button", { name: "Continue" }).first().click();
        await page
            .getByRole("button", { name: audio.continueRecording })
            .click();
        await expect(page.getByText(audio.recordingInProgress)).toBeVisible();
    });
});
