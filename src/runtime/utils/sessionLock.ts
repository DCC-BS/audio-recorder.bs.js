/*
    A session belongs to the recorder that records (or holds it paused) in
    this page. Other tabs must neither resume it nor list it as interrupted,
    so ownership is a Web Lock: it is released when the owner lets go, and
    by the browser when the tab closes or crashes. Without the Locks API
    (insecure contexts, very old browsers) every session counts as free.
*/

const LOCK_PREFIX = "audio-recorder-session:";

function hasLocks(): boolean {
    // some environments define the property but leave it null
    return typeof navigator !== "undefined" && Boolean(navigator.locks);
}

/**
 * Takes ownership of a session.
 *
 * @param sessionId - The session to own.
 * @returns A function that releases the lock, or `undefined` when another
 *   page already owns the session.
 */
export async function acquireSessionLock(
    sessionId: string,
): Promise<(() => void) | undefined> {
    if (!hasLocks()) {
        return () => {};
    }

    return new Promise((resolve) => {
        navigator.locks
            .request(LOCK_PREFIX + sessionId, { ifAvailable: true }, (lock) => {
                if (!lock) {
                    resolve(undefined);
                    return;
                }
                // held until the returned release function is called
                return new Promise<void>((release) => {
                    resolve(() => release());
                });
            })
            .catch(() => resolve(() => {}));
    });
}

/**
 * Lists the sessions some page currently owns.
 *
 * @returns The ids of sessions being recorded or held paused right now.
 */
export async function getLiveSessionIds(): Promise<Set<string>> {
    if (!hasLocks()) {
        return new Set();
    }
    try {
        const { held = [] } = await navigator.locks.query();
        return new Set(
            held
                .map((lock) => lock.name ?? "")
                .filter((name) => name.startsWith(LOCK_PREFIX))
                .map((name) => name.slice(LOCK_PREFIX.length)),
        );
    } catch {
        return new Set();
    }
}
