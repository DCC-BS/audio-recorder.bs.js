// A page owns the sessions it records or holds paused through a Web Lock,
// released when it lets go or the tab dies. Without the Locks API every
// session counts as free.

const LOCK_PREFIX = "audio-recorder-session:";

function hasLocks(): boolean {
    // some environments define the property but leave it null
    return typeof navigator !== "undefined" && Boolean(navigator.locks);
}

/** @returns A release function, or `undefined` if another page owns it. */
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

/** Ids of the sessions some page owns right now. */
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
