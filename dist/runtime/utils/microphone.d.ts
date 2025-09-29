export type CheckMicrophoneAvailabilityResult = {
    isAvailable: boolean;
    message?: string;
};
export declare function checkMicrophoneAvailability(): Promise<CheckMicrophoneAvailabilityResult>;
/**
 * Handle microphone access errors with specific messages
 */
export declare function handleMicrophoneError(error: Error): string;
