import { chromium } from "playwright";

(async () => {
    const context = await chromium.launchPersistentContext("", {
        headless: false,
        args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            // Optionally: '--use-file-for-fake-video-capture=/path/to/video.y4m'
        ],
    });
    const page = await context.newPage();
    await page.pause(); // This opens Playwright Inspector/codegen GUI
    // Interact and generate code as usual via the Inspector
})();
