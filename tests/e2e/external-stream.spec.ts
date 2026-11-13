import { expect, test } from "@playwright/test";

/*
    `getStream` lets an app record something other than the microphone (a
    meeting: microphone mixed with screen audio) while keeping the chunked
    IndexedDB storage that survives a reload.
*/
test.describe("Recording an external stream", () => {
    let pageErrors: string[] = [];

    test.afterEach(() => {
        expect(pageErrors).toEqual([]);
    });

    test.beforeEach(async ({ page }) => {
        pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));
        // count microphone requests: an external stream must not open the mic
        await page.addInitScript(() => {
            const w = window as unknown as { micRequests: number };
            w.micRequests = 0;
            const original = navigator.mediaDevices.getUserMedia.bind(
                navigator.mediaDevices,
            );
            navigator.mediaDevices.getUserMedia = (constraints) => {
                w.micRequests++;
                return original(constraints);
            };
        });
        await page.goto("/externalStream");
    });

    test("records the stream and stores chunks while recording", async ({
        page,
    }) => {
        await page.getByTestId("start").click();
        await expect(page.getByTestId("recording")).toHaveText("true");

        // storeToDbInterval is 1s, so a chunk must land before stopping
        await expect
            .poll(() => countStoredChunks(page), { timeout: 15_000 })
            .toBeGreaterThan(0);

        await page.getByTestId("stop").click();
        await expect(page.getByTestId("recording")).toHaveText("false");
        await expect
            .poll(
                async () =>
                    Number(await page.getByTestId("size").textContent()),
                {
                    timeout: 15_000,
                },
            )
            .toBeGreaterThan(0);

        expect(
            await page.evaluate(
                () =>
                    (window as unknown as { micRequests: number }).micRequests,
            ),
        ).toBe(0);
        await expect(page.getByTestId("error")).toBeEmpty();
    });

    test("leaves the caller's stream running after stop", async ({ page }) => {
        await page.getByTestId("start").click();
        await expect(page.getByTestId("recording")).toHaveText("true");
        await page.getByTestId("stop").click();
        await expect(page.getByTestId("recording")).toHaveText("false");

        const state = await page.evaluate(
            () =>
                (
                    window as unknown as { sourceStream: MediaStream }
                ).sourceStream.getAudioTracks()[0]?.readyState,
        );
        expect(state).toBe("live");
        await page.getByTestId("release").click();
    });
});

/**
 * Counts the audio chunks the recorder has written to IndexedDB.
 *
 * @param page - The page under test.
 * @returns Number of stored chunks.
 */
function countStoredChunks(
    page: import("@playwright/test").Page,
): Promise<number> {
    return page.evaluate(
        () =>
            new Promise<number>((resolve, reject) => {
                const open = indexedDB.open("AudioRecorderDB");
                open.onerror = () => reject(open.error);
                open.onsuccess = () => {
                    const db = open.result;
                    if (!db.objectStoreNames.contains("audioChunks")) {
                        db.close();
                        resolve(0);
                        return;
                    }
                    const count = db
                        .transaction("audioChunks")
                        .objectStore("audioChunks")
                        .count();
                    count.onsuccess = () => {
                        db.close();
                        resolve(count.result);
                    };
                    count.onerror = () => reject(count.error);
                };
            }),
    );
}
