import type { Page } from "@playwright/test";

/**
 * Counts the records in one of the recorder's IndexedDB tables.
 *
 * @param page - The page under test.
 * @param table - The object store to count.
 * @returns Number of records.
 */
export function countStored(
    page: Page,
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

/** Counts the audio chunks the recorder has written to IndexedDB. */
export function countStoredChunks(page: Page): Promise<number> {
    return countStored(page, "audioChunks");
}
