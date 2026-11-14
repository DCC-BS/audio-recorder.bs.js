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

    test("ignores a second start while the first is starting", async ({
        page,
    }) => {
        // a raw DOM click has no actionability wait: let Vue mount first
        await page.waitForFunction(
            () =>
                (document.querySelector("#__nuxt") as { __vue_app__?: unknown })
                    ?.__vue_app__,
        );
        // both clicks land before the first start has finished
        await page.evaluate(() => {
            const start = document.querySelector<HTMLButtonElement>(
                '[data-testid="start"]',
            );
            start?.click();
            start?.click();
        });
        await expect(page.getByTestId("recording")).toHaveText("true");
        expect(
            await page.evaluate(
                () =>
                    (window as unknown as { streamRequests: number })
                        .streamRequests,
            ),
        ).toBe(1);

        await page.waitForTimeout(1500);
        await page.getByTestId("stop").click();
        await expect
            .poll(
                async () =>
                    Number(await page.getByTestId("size").textContent()),
                { timeout: 15_000 },
            )
            .toBeGreaterThan(0);
        await page.getByTestId("release").click();
    });

    test("leaves the caller's stream running after stop", async ({ page }) => {
        await page.getByTestId("start").click();
        await expect(page.getByTestId("recording")).toHaveText("true");
        // record something, or stop has nothing to hand back
        await page.waitForTimeout(1500);
        await page.getByTestId("stop").click();
        // the recorder is torn down only after the final chunk is encoded,
        // so wait for the finished recording before looking at the source
        await expect
            .poll(
                async () =>
                    Number(await page.getByTestId("size").textContent()),
                { timeout: 15_000 },
            )
            .toBeGreaterThan(0);

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

test("reports a failing getStream as its own error", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto("/externalStream?fail=1");

    await page.getByTestId("start").click();
    await expect(page.getByTestId("error")).toHaveText(
        "Screen share cancelled",
    );
    await expect(page.getByTestId("recording")).toHaveText("false");
    await expect(page.getByTestId("processing")).toHaveText("false");
    expect(pageErrors).toEqual([]);
});

test("drops a start whose page was left meanwhile", async ({ page }) => {
    await page.goto("/externalStream?slow=1");
    await page.getByTestId("start").click();
    // leave while getStream is still pending
    await page.getByTestId("leave").click();
    await page.waitForURL("/");
    await page.waitForTimeout(3000);

    expect(await countStored(page, "audioSessions")).toBe(0);
    expect(await countStored(page, "audioChunks")).toBe(0);
});

test("reports a lost chunk and keeps the rest", async ({ page }) => {
    await page.goto("/externalStream?failStore=1");
    await page.getByTestId("start").click();
    await expect(page.getByTestId("recording")).toHaveText("true");
    // the first chunk fails, later ones are stored
    await expect
        .poll(() => countStoredChunks(page), { timeout: 15_000 })
        .toBeGreaterThan(0);
    await page.getByTestId("stop").click();

    await expect(page.getByTestId("error")).toContainText(
        "Part of the recording could not be stored",
        { timeout: 15_000 },
    );
    await expect(page.getByTestId("size")).toBeEmpty();
    expect(await countStored(page, "audioSessions")).toBe(1);
    await page.getByTestId("release").click();
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
    return countStored(page, "audioChunks");
}

/**
 * Counts the records in one of the recorder's IndexedDB tables.
 *
 * @param page - The page under test.
 * @param table - The object store to count.
 * @returns Number of records.
 */
function countStored(
    page: import("@playwright/test").Page,
    table: "audioChunks" | "audioSessions",
): Promise<number> {
    return page.evaluate(
        (table) =>
            new Promise<number>((resolve, reject) => {
                const open = indexedDB.open("AudioRecorderDB");
                open.onerror = () => reject(open.error);
                open.onsuccess = () => {
                    const db = open.result;
                    if (!db.objectStoreNames.contains(table)) {
                        db.close();
                        resolve(0);
                        return;
                    }
                    const count = db
                        .transaction(table)
                        .objectStore(table)
                        .count();
                    count.onsuccess = () => {
                        db.close();
                        resolve(count.result);
                    };
                    count.onerror = () => reject(count.error);
                };
            }),
        table,
    );
}
