/**
 * Whether this is an iPhone or iPad, where every browser is WebKit.
 * iPadOS reports itself as a Mac, so it is told apart by its touch screen.
 */
export function isIOS(): boolean {
    if (typeof navigator === "undefined") {
        return false;
    }
    return (
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
}

/**
 * Whether the app runs installed (home screen / standalone PWA) rather
 * than in a browser tab.
 */
export function isStandalone(): boolean {
    if (typeof window === "undefined") {
        return false;
    }
    return (
        (navigator as Navigator & { standalone?: boolean }).standalone ===
            true || window.matchMedia?.("(display-mode: standalone)").matches
    );
}
