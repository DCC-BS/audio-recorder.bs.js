import {
    createAudioStorage,
    type AudioStorageService,
} from "../services/audioStorage";

// Example usage of AudioStorageService (Memory-Efficient Version)

export function audioStorageExample() {
    // Initialize the audio storage service
    const audioStorage: AudioStorageService = createAudioStorage({
        maxSessions: 10,
        maxBlobsPerSession: 50,
    });

    // Load existing data on initialization
    audioStorage.loadFromIndexedDB();

    // Example: Create a new session
    async function createNewRecordingSession(sessionName?: string) {
        const sessionId = await audioStorage.createSession(
            sessionName || `Recording ${new Date().toLocaleString()}`,
        );
        console.log("Created session:", sessionId);
        return sessionId;
    }

    // Example: Add MP3 blob to session (from audio recording)
    async function addRecordingToSession(
        sessionId: string,
        mp3Blob: Blob,
        recordingName?: string,
    ) {
        try {
            const blobId = await audioStorage.appendBlobToSession(
                sessionId,
                mp3Blob,
                recordingName,
            );
            console.log("Added blob to session:", { sessionId, blobId });
            return blobId;
        } catch (error) {
            console.error("Failed to add blob:", error);
            return null;
        }
    }

    // Example: Get all recording metadata from a session (memory efficient)
    function getSessionRecordings(sessionId: string) {
        const blobsMetadata = audioStorage.getSessionBlobsMetadata(sessionId);
        console.log(
            `Session ${sessionId} has ${blobsMetadata.length} recordings`,
        );
        return blobsMetadata;
    }

    // Example: Play a specific recording (loads from IndexedDB only when needed)
    async function playRecording(sessionId: string, blobId: string) {
        try {
            const audioBlob = await audioStorage.getBlob(sessionId, blobId);
            if (audioBlob) {
                const audioUrl = URL.createObjectURL(audioBlob);
                const audio = new Audio(audioUrl);
                audio.play();

                // Clean up the URL when done
                audio.addEventListener("ended", () => {
                    URL.revokeObjectURL(audioUrl);
                });

                return audio;
            }
        } catch (error) {
            console.error("Recording not found:", error);
        }
        return null;
    }

    // Example: Delete a recording from session
    async function removeRecording(sessionId: string, blobId: string) {
        try {
            const success = await audioStorage.deleteBlobFromSession(
                sessionId,
                blobId,
            );
            console.log("Recording removed successfully");
            return success;
        } catch (error) {
            console.error("Failed to remove recording:", error);
            return false;
        }
    }

    // Example: Delete entire session
    async function removeSession(sessionId: string) {
        try {
            const success = await audioStorage.deleteSession(sessionId);
            console.log("Session deleted successfully");
            return success;
        } catch (error) {
            console.error("Failed to delete session:", error);
            return false;
        }
    }

    // Example: Get session statistics (using metadata only - no memory usage for blobs)
    function getSessionStats(sessionId: string) {
        const session = audioStorage.getSession(sessionId);
        if (session) {
            return {
                name: session.name,
                recordingCount: session.blobCount,
                totalSizeBytes: session.totalSize,
                totalSizeMB: (session.totalSize / (1024 * 1024)).toFixed(2),
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
            };
        }
        return null;
    }

    // Example: Export session as downloadable files (loads blobs only when exporting)
    async function exportSession(sessionId: string) {
        const blobsMetadata = audioStorage.getSessionBlobsMetadata(sessionId);
        const session = audioStorage.getSession(sessionId);

        for (let i = 0; i < blobsMetadata.length; i++) {
            const metadata = blobsMetadata[i];
            if (metadata) {
                try {
                    const blob = await audioStorage.getBlob(
                        sessionId,
                        metadata.id,
                    );

                    if (blob) {
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = `${session?.name || "session"}_${metadata.name || `recording_${i + 1}`}.mp3`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                    }
                } catch (error) {
                    console.error("Failed to export recording:", error);
                }
            }
        }
    }

    // Example: Get service statistics
    function getStorageStats() {
        return {
            sessionCount: audioStorage.sessionCount,
            totalBlobCount: audioStorage.totalBlobCount,
            totalStorageSize: audioStorage.totalStorageSize,
            totalStorageSizeMB: (
                audioStorage.totalStorageSize /
                (1024 * 1024)
            ).toFixed(2),
        };
    }

    return {
        // Service instance
        audioStorage,

        // Example functions
        createNewRecordingSession,
        addRecordingToSession,
        getSessionRecordings,
        playRecording,
        removeRecording,
        removeSession,
        getSessionStats,
        exportSession,
        getStorageStats,
    };
}

/*
Memory-Efficient Service Class Usage Example:

const { audioStorage } = audioStorageExample()

// Or use directly:
import { createAudioStorage } from './audioStorage'
const storage = createAudioStorage({ maxSessions: 10, maxBlobsPerSession: 50 })

// Create a session (async)
const sessionId = await storage.createSession("My Interview")

// Add recordings (you'd get these from your audio recording composable) - async
const mp3Blob = new Blob([...], { type: 'audio/mp3' })
await storage.appendBlobToSession(sessionId, mp3Blob, "Question 1")

// Retrieve recording metadata (no blob data in memory)
const recordings = storage.getSessionBlobsMetadata(sessionId)

// Play a recording (loads blob from IndexedDB only when needed) - async
const blob = await storage.getBlob(sessionId, recordings[0].id)
if (blob) {
    const audio = new Audio(URL.createObjectURL(blob))
    audio.play()
}

// Get session info (uses metadata only, no memory usage for blobs)
const session = storage.getSession(sessionId)
console.log(`Session has ${session?.blobCount} recordings, total size: ${(session?.totalSize / (1024 * 1024)).toFixed(2)}MB`)

// Get storage statistics
console.log(`Total sessions: ${storage.sessionCount}, Total blobs: ${storage.totalBlobCount}`)

// Clean up - async
await storage.deleteSession(sessionId)

Key Benefits:
- ✅ No out of memory issues - blobs stored in IndexedDB, only metadata in RAM
- ✅ Fast session/recording browsing - uses lightweight metadata  
- ✅ Blobs loaded on-demand from IndexedDB only when actually needed
- ✅ Persistent storage across browser sessions
- ✅ Automatic cleanup when sessions are deleted
- ✅ Configurable limits to prevent storage abuse
- ✅ Simple service class API - no reactive complexity
- ✅ Error handling with exceptions instead of error state
*/
