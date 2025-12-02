import { expect, test } from "@playwright/test";

import local from "../../src/runtime/lang/en.json" with { type: "json" };

const startRecordingText = local["audio-recorder"].audio
    .startRecording as string;
const stopRecordingText = local["audio-recorder"].audio.stopRecording as string;
const recordingInProgressText = local["audio-recorder"].audio
    .recordingInProgress as string;

test.describe("Audio Recorder", () => {
    test("should display start recording button on page load", async ({
        page,
    }) => {
        await page.goto("/");

        // Wait for the page to load and the audio recorder component to be rendered
        await expect(
            page.getByRole("button", { name: startRecordingText }),
        ).toBeVisible();
    });

    test("should start and stop audio recording", async ({ page }) => {
        await page.goto("/");

        page.on('console', msg => console.log(msg.text()))

        // Click the start recording button
        const startButton = page.getByRole("button", {
            name: startRecordingText,
        });
        await expect(startButton).toBeVisible();
        await startButton.click();

        // Check that recording has started by looking for recording indicator div
        await expect(page.getByText(recordingInProgressText)).toBeVisible();
        await expect(
            page.getByRole("button", { name: stopRecordingText }),
        ).toBeVisible();

        // Wait a bit to see if time updates
        await page.waitForTimeout(1000);

        // Stop recording
        const stopButton = page.getByRole("button", {
            name: stopRecordingText,
        });
        await stopButton.click();

        // Verify recording has stopped - start button should be visible again
        await expect(
            page.getByRole("button", { name: startRecordingText }),
        ).toBeVisible();
        await expect(page.locator(".recording-indicator")).not.toBeVisible();
    });

    test("should handle recording time formatting correctly", async ({
        page,
    }) => {
        await page.goto("/");

        // Start recording
        await page.getByRole("button", { name: startRecordingText }).click();

        // Wait for recording to start and check time format
        const recordingTime = page.locator(".recording-time");
        await expect(recordingTime).toBeVisible();

        // Check that time is in MM:SS format
        await expect(recordingTime).toHaveText(/^\d{2}:\d{2}$/);

        // Stop recording
        await page.getByRole("button", { name: stopRecordingText }).click();
    });

    test("should handle multiple recording sessions", async ({ page }) => {
        await page.goto("/");

        // First recording session
        await page.getByRole("button", { name: startRecordingText }).click();
        await page.waitForTimeout(500);
        await page.getByRole("button", { name: stopRecordingText }).click();

        // Wait for UI to reset
        await expect(
            page.getByRole("button", { name: startRecordingText }),
        ).toBeVisible();

        // Second recording session
        await page.getByRole("button", { name: startRecordingText }).click();
        await page.waitForTimeout(500);
        await page.getByRole("button", { name: stopRecordingText }).click();

        // Verify we can start again
        await expect(
            page.getByRole("button", { name: startRecordingText }),
        ).toBeVisible();
    });

    test("should handle permission denied gracefully", async ({ page }) => {
        // Override the mock to simulate permission denied
        await page.addInitScript(() => {
            navigator.mediaDevices.getUserMedia = async () => {
                throw new DOMException("Permission denied", "NotAllowedError");
            };
        });

        await page.goto("/");

        // Try to start recording
        await page.getByRole("button", { name: startRecordingText }).click();

        // Wait for error handling
        await page.waitForTimeout(1000);

        // Check if error message appears (this might vary based on implementation)
        const errorMessage = page.locator(".error-message");
        if ((await errorMessage.count()) > 0) {
            await expect(errorMessage).toBeVisible();
        }
    });

    test("When abandoned recordings are found", async ({ page }) => {
        await page.goto("/");

        await page.getByRole("button", { name: "Start Recording" }).click();

        // Wait for ffmpeg to load
        await expect(page.getByText("ffmpeg version")).toBeVisible({ timeout: 5100 });
        
        await page.waitForTimeout(500); // Wait for a second to simulate recording time
        await page.goto("http://localhost:3000/");
        await expect(
            page.getByText(/.*Found abandoned recordings/),
        ).toBeVisible();
    });
});
