/** iPhone or iPad; iPadOS reports a Mac, so it is told apart by touch. */
export function isIOS(): boolean {
    if (typeof navigator === "undefined") {
        return false;
    }
    return (
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
}

/** Running as an installed (standalone) PWA. */
export function isStandalone(): boolean {
    if (typeof window === "undefined") {
        return false;
    }
    return (
        (navigator as Navigator & { standalone?: boolean }).standalone ===
            true || window.matchMedia?.("(display-mode: standalone)").matches
    );
}
