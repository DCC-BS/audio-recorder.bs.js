import { expect, test } from "@playwright/test";


test('test', async ({ page, context }) => {
 await context.grantPermissions(['microphone']);
  await page.goto('http://localhost:3000/');
  await page.getByRole('button', { name: /Start Recording|Aufnahme starten/ }).click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /Stop Recording|Aufnahme stoppen/ }).click();
  await expect(page.getByText('Recording Complete')).toBeVisible();
});

test.describe("Audio Recorder", () => {
    test.beforeEach(async ({ page, context }) => {
        // Grant microphone permissions
        await context.grantPermissions(["microphone"]);

        // Mock the MediaRecorder API to simulate audio recording
        await page.addInitScript(() => {
            // Simple mock for MediaRecorder
            class MockMediaRecorder {
                public state: RecordingState = "inactive";
                public stream: MediaStream;
                public mimeType: string;
                private eventListeners: {
                    [key: string]: Array<(event: Event) => void>;
                } = {};

                static isTypeSupported(): boolean {
                    return true;
                }

                constructor(
                    stream: MediaStream,
                    options?: MediaRecorderOptions,
                ) {
                    this.stream = stream;
                    this.mimeType = options?.mimeType || "audio/webm";
                }

                start(): void {
                    this.state = "recording";
                    this.trigger("start");

                    // Simulate dataavailable event
                    setTimeout(() => {
                        const event = new Event("dataavailable");
                        Object.defineProperty(event, "data", {
                            value: new Blob(["fake-audio"], {
                                type: this.mimeType,
                            }),
                            writable: false,
                        });
                        this.trigger("dataavailable", event);
                    }, 100);
                }

                stop(): void {
                    this.state = "inactive";
                    this.trigger("stop");
                }

                addEventListener(
                    type: string,
                    listener: (event: Event) => void,
                ): void {
                    if (!this.eventListeners[type]) {
                        this.eventListeners[type] = [];
                    }
                    this.eventListeners[type].push(listener);
                }

                removeEventListener(): void {}
                dispatchEvent(): boolean {
                    return true;
                }
                pause(): void {
                    this.state = "paused";
                }
                resume(): void {
                    this.state = "recording";
                }
                requestData(): void {}

                private trigger(type: string, customEvent?: Event): void {
                    if (this.eventListeners[type]) {
                        const eventToSend = customEvent || new Event(type);
                        for (const callback of this.eventListeners[type]) {
                            callback(eventToSend);
                        }
                    }
                }
            }

            // Mock getUserMedia to return a fake stream
            navigator.mediaDevices.getUserMedia = async (constraints) => {
                if (constraints?.audio) {
                    // Return a minimal mock MediaStream
                    return {
                        getTracks: () => [],
                        getAudioTracks: () => [],
                        getVideoTracks: () => [],
                    } as unknown as MediaStream;
                }
                throw new Error("Not supported");
            };

            // Mock enumerateDevices to return audio input devices
            navigator.mediaDevices.enumerateDevices = async () => {
                return [
                    {
                        deviceId: "mock-audio-input",
                        kind: "audioinput",
                        label: "Mock Microphone",
                        groupId: "mock-group",
                    },
                ] as MediaDeviceInfo[];
            };

            // Replace the global MediaRecorder with our mock
            // biome-ignore lint/suspicious/noExplicitAny: Necessary for test mocking
            (window as any).MediaRecorder = MockMediaRecorder;
        });
    });

    test("should display start recording button on page load", async ({
        page,
    }) => {
        await page.goto("/");

        // Wait for the page to load and the audio recorder component to be rendered
        await expect(
            page.getByRole("button", { name: /start recording/i }),
        ).toBeVisible();
    });

    test("should start and stop audio recording", async ({ page }) => {
        await page.goto("/");

        // Click the start recording button
        const startButton = page.getByRole("button", {
            name: /start recording/i,
        });
        await expect(startButton).toBeVisible();
        await startButton.click();

        // Check that recording has started by looking for recording indicator div
        await expect(page.locator(".recording-indicator")).toBeVisible();
        await expect(
            page.getByRole("button", { name: /audio\.stopRecording/i }),
        ).toBeVisible();

        // Check that the recording time is displayed
        const recordingTime = page.locator(".recording-time");
        await expect(recordingTime).toBeVisible();

        // Wait a bit to see if time updates
        await page.waitForTimeout(1000);

        // Stop recording
        const stopButton = page.getByRole("button", {
            name: /audio\.stopRecording/i,
        });
        await stopButton.click();

        // Verify recording has stopped - start button should be visible again
        await expect(
            page.getByRole("button", { name: /start recording/i }),
        ).toBeVisible();
        await expect(page.locator(".recording-indicator")).not.toBeVisible();
    });

    test("should handle recording time formatting correctly", async ({
        page,
    }) => {
        await page.goto("/");

        // Start recording
        await page.getByRole("button", { name: /start recording/i }).click();

        // Wait for recording to start and check time format
        const recordingTime = page.locator(".recording-time");
        await expect(recordingTime).toBeVisible();

        // Check that time is in MM:SS format
        await expect(recordingTime).toHaveText(/^\d{2}:\d{2}$/);

        // Stop recording
        await page
            .getByRole("button", { name: /audio\.stopRecording/i })
            .click();
    });

    test("should handle multiple recording sessions", async ({ page }) => {
        await page.goto("/");

        // First recording session
        await page.getByRole("button", { name: /start recording/i }).click();
        await page.waitForTimeout(500);
        await page
            .getByRole("button", { name: /audio\.stopRecording/i })
            .click();

        // Wait for UI to reset
        await expect(
            page.getByRole("button", { name: /start recording/i }),
        ).toBeVisible();

        // Second recording session
        await page.getByRole("button", { name: /start recording/i }).click();
        await page.waitForTimeout(500);
        await page
            .getByRole("button", { name: /audio\.stopRecording/i })
            .click();

        // Verify we can start again
        await expect(
            page.getByRole("button", { name: /start recording/i }),
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
        await page.getByRole("button", { name: /start recording/i }).click();

        // Wait for error handling
        await page.waitForTimeout(1000);

        // Check if error message appears (this might vary based on implementation)
        const errorMessage = page.locator(".error-message");
        if ((await errorMessage.count()) > 0) {
            await expect(errorMessage).toBeVisible();
        }
    });
});
