import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    testDir: "./tests/e2e",
    testMatch: "**/*.spec.ts",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI
        ? [
              ["github"],
              ["json", { outputFile: "results.json" }],
              ["html", { outputFolder: "playwright-report" }],
          ]
        : "list",
    use: {
        baseURL: "http://localhost:3000",
        trace: "on-first-retry",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        channel: "chromium",
        permissions: ["microphone"],
        launchOptions: {
            args: [
                "--use-fake-device-for-media-stream",
                "--no-sandbox",
                `--use-file-for-fake-audio-capture=${path.resolve(__dirname, "./tests/e2e/recording.wav")}`,
            ],
        },
    },

    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],

    webServer: {
        command: "node ./playground/.output/server/index.mjs",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
    },
});
