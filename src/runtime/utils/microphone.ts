export type CheckMicrophoneAvailabilityResult = {
    isAvailable: boolean;
    message?: string;
};

export async function checkMicrophoneAvailability(): Promise<CheckMicrophoneAvailabilityResult> {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasAudioInput = devices.some(
            (device) => device.kind === "audioinput",
        );

        if (!hasAudioInput) {
            return {
                isAvailable: false,
                message: "No microphone detected on your device.",
            };
        }

        return { isAvailable: true };
    } catch (_) {
        return {
            isAvailable: false,
            message:
                "Error accessing media devices. Please check your permissions.",
        };
    }
}

/**
 * Handle microphone access errors with specific messages
 */
export function handleMicrophoneError(error: Error): string {
    // Set appropriate error message based on error type
    if (
        error.name === "NotFoundError" ||
        error.name === "DevicesNotFoundError"
    ) {
        return "No microphone found. Please connect a microphone and try again.";
    }

    if (
        error.name === "NotAllowedError" ||
        error.name === "PermissionDeniedError"
    ) {
        return "Microphone access denied. Please allow microphone access in your browser settings.";
    }

    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
        return "Your microphone is in use by another application.";
    }

    if (
        error.name === "OverconstrainedError" ||
        error.name === "ConstraintNotSatisfiedError"
    ) {
        return "Microphone constraints cannot be satisfied.";
    }
    if (error.name === "TypeError") {
        return "No microphone found or it's not compatible with your browser.";
    }

    return `Microphone error: ${error.message}`;
}
