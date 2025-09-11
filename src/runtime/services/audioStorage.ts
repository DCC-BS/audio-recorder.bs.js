// Types for audio storage - lightweight metadata only
export interface AudioBlobMetadata {
    id: string;
    sessionId: string;
    createdAt: Date;
    duration?: number;
    name?: string;
    size: number; // blob size in bytes
    type: string; // mime type
}

export interface AudioSession {
    id: string;
    name?: string;
    createdAt: Date;
    updatedAt: Date;
    blobCount: number;
    totalSize: number; // total size of all blobs in bytes
}

export interface AudioStorageOptions {
    maxSessions?: number;
    maxBlobsPerSession?: number;
}

// IndexedDB storage interfaces
interface StoredAudioBlob {
    id: string;
    sessionId: string;
    createdAt: string;
    duration?: number;
    name?: string;
    size: number;
    type: string;
    blobData: ArrayBuffer;
}

interface StoredAudioSession {
    id: string;
    name?: string;
    createdAt: string;
    updatedAt: string;
    blobCount: number;
    totalSize: number;
}

export class AudioStorageService {
    private sessions: Map<string, AudioSession> = new Map();
    private blobMetadata: Map<string, AudioBlobMetadata> = new Map();
    private maxSessions: number;
    private maxBlobsPerSession: number;

    constructor(options: AudioStorageOptions = {}) {
        this.maxSessions = options.maxSessions ?? 50;
        this.maxBlobsPerSession = options.maxBlobsPerSession ?? 100;
    }

    // Generate unique ID
    private generateId(): string {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    // Initialize IndexedDB
    private openIndexedDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open("AudioStorage", 2);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);

            request.onupgradeneeded = () => {
                const db = request.result;

                // Create sessions store
                if (!db.objectStoreNames.contains("sessions")) {
                    db.createObjectStore("sessions", { keyPath: "id" });
                }

                // Create blobs store
                if (!db.objectStoreNames.contains("audioBlobs")) {
                    const blobStore = db.createObjectStore("audioBlobs", {
                        keyPath: "id",
                    });
                    blobStore.createIndex("sessionId", "sessionId", {
                        unique: false,
                    });
                }
            };
        });
    }

    // Create a new audio session
    async createSession(name?: string): Promise<string> {
        // Check if we've reached the maximum number of sessions
        if (this.sessions.size >= this.maxSessions) {
            // Remove the oldest session to make room
            const oldestSession = Array.from(this.sessions.values()).sort(
                (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
            )[0];
            if (oldestSession) {
                await this.deleteSession(oldestSession.id);
            }
        }

        const sessionId = this.generateId();
        const session: AudioSession = {
            id: sessionId,
            name,
            createdAt: new Date(),
            updatedAt: new Date(),
            blobCount: 0,
            totalSize: 0,
        };

        this.sessions.set(sessionId, session);

        // Save to IndexedDB
        try {
            const db = await this.openIndexedDB();
            const transaction = db.transaction(["sessions"], "readwrite");
            const store = transaction.objectStore("sessions");
            const storedSession: StoredAudioSession = {
                ...session,
                createdAt: session.createdAt.toISOString(),
                updatedAt: session.updatedAt.toISOString(),
            };
            store.put(storedSession);
        } catch (err) {
            console.warn("Failed to save session to IndexedDB:", err);
        }

        return sessionId;
    }

    // Add audio blob to a session (stores blob in IndexedDB, metadata in memory)
    async appendBlobToSession(
        sessionId: string,
        blob: Blob,
        blobName?: string,
    ): Promise<string | null> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session with id ${sessionId} not found`);
        }

        // Check max blobs limit
        if (session.blobCount >= this.maxBlobsPerSession) {
            throw new Error(
                `Session has reached maximum of ${this.maxBlobsPerSession} audio blobs`,
            );
        }

        const blobId = this.generateId();
        const metadata: AudioBlobMetadata = {
            id: blobId,
            sessionId,
            createdAt: new Date(),
            name: blobName,
            size: blob.size,
            type: blob.type,
        };

        try {
            // Store blob data in IndexedDB
            const db = await this.openIndexedDB();
            const transaction = db.transaction(
                ["audioBlobs", "sessions"],
                "readwrite",
            );

            // Save blob to IndexedDB
            const blobStore = transaction.objectStore("audioBlobs");
            const storedBlob: StoredAudioBlob = {
                id: blobId,
                sessionId,
                createdAt: metadata.createdAt.toISOString(),
                name: blobName,
                size: blob.size,
                type: blob.type,
                blobData: await blob.arrayBuffer(),
            };

            return new Promise((resolve, reject) => {
                const putRequest = blobStore.put(storedBlob);
                putRequest.onsuccess = () => {
                    // Update session metadata
                    session.blobCount += 1;
                    session.totalSize += blob.size;
                    session.updatedAt = new Date();

                    const sessionStore = transaction.objectStore("sessions");
                    const sessionPutRequest = sessionStore.put({
                        ...session,
                        createdAt: session.createdAt.toISOString(),
                        updatedAt: session.updatedAt.toISOString(),
                    });

                    sessionPutRequest.onsuccess = () => {
                        // Update in-memory metadata
                        this.blobMetadata.set(blobId, metadata);
                        this.sessions.set(sessionId, { ...session });
                        resolve(blobId);
                    };
                    sessionPutRequest.onerror = () =>
                        reject(sessionPutRequest.error);
                };
                putRequest.onerror = () => reject(putRequest.error);
            });
        } catch (err) {
            console.error("Failed to save blob:", err);
            throw new Error("Failed to save audio blob");
        }
    }

    async getBlobs(sessionId: string): Promise<Blob[]> {
        const blobs: Blob[] = [];

        for (const metadata of this.blobMetadata.values()) {
            if (metadata.sessionId === sessionId) {
                const blob = await this.getBlob(sessionId, metadata.id);
                if (blob) {
                    blobs.push(blob as Blob);
                } else {
                    throw new Error(
                        `Blob with id ${metadata.id} not found in session ${sessionId}`,
                    );
                }
            }
        }

        return blobs;
    }

    // Get blob metadata for a session
    getSessionBlobsMetadata(sessionId: string): AudioBlobMetadata[] {
        const sessionMetadata: AudioBlobMetadata[] = [];

        this.blobMetadata.forEach((metadata) => {
            if (metadata.sessionId === sessionId) {
                sessionMetadata.push(metadata);
            }
        });

        return sessionMetadata.sort(
            (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );
    }

    // Get actual blob from IndexedDB
    async getBlob(sessionId: string, blobId: string): Promise<Blob | null> {
        const metadata = this.blobMetadata.get(blobId);
        if (!metadata || metadata.sessionId !== sessionId) {
            throw new Error(
                `Blob with id ${blobId} not found in session ${sessionId}`,
            );
        }

        try {
            const db = await this.openIndexedDB();
            const transaction = db.transaction(["audioBlobs"], "readonly");
            const store = transaction.objectStore("audioBlobs");

            return new Promise((resolve, reject) => {
                const request = store.get(blobId);
                request.onsuccess = () => {
                    const storedBlob = request.result as StoredAudioBlob;
                    if (storedBlob) {
                        const blob = new Blob([storedBlob.blobData], {
                            type: storedBlob.type,
                        });
                        resolve(blob);
                    } else {
                        resolve(null);
                    }
                };
                request.onerror = () => reject(request.error);
            });
        } catch (err) {
            console.error("Failed to retrieve blob:", err);
            throw new Error("Failed to retrieve audio blob");
        }
    }

    // Get blob metadata only
    getBlobMetadata(
        sessionId: string,
        blobId: string,
    ): AudioBlobMetadata | null {
        const metadata = this.blobMetadata.get(blobId);
        if (!metadata || metadata.sessionId !== sessionId) {
            return null;
        }

        return metadata;
    }

    // Delete a session and all its blobs
    async deleteSession(sessionId: string): Promise<boolean> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session with id ${sessionId} not found`);
        }

        try {
            const db = await this.openIndexedDB();
            const transaction = db.transaction(
                ["sessions", "audioBlobs"],
                "readwrite",
            );

            // Delete all blobs for this session
            const blobStore = transaction.objectStore("audioBlobs");
            const sessionIndex = blobStore.index("sessionId");

            return new Promise((resolve, reject) => {
                const blobRequest = sessionIndex.getAll(sessionId);
                blobRequest.onsuccess = () => {
                    const blobs = blobRequest.result as StoredAudioBlob[];

                    // Delete each blob
                    const deletePromises = blobs.map((blob) => {
                        this.blobMetadata.delete(blob.id);
                        return blobStore.delete(blob.id);
                    });

                    Promise.all(deletePromises)
                        .then(() => {
                            // Delete session
                            const sessionStore =
                                transaction.objectStore("sessions");
                            const sessionDeleteRequest =
                                sessionStore.delete(sessionId);

                            sessionDeleteRequest.onsuccess = () => {
                                // Remove from memory
                                this.sessions.delete(sessionId);
                                resolve(true);
                            };
                            sessionDeleteRequest.onerror = () =>
                                reject(sessionDeleteRequest.error);
                        })
                        .catch(reject);
                };
                blobRequest.onerror = () => reject(blobRequest.error);
            });
        } catch (err) {
            console.error("Failed to delete session:", err);
            throw new Error("Failed to delete session");
        }
    }

    // Delete a specific blob from a session
    async deleteBlobFromSession(
        sessionId: string,
        blobId: string,
    ): Promise<boolean> {
        const session = this.sessions.get(sessionId);
        const metadata = this.blobMetadata.get(blobId);

        if (!session || !metadata || metadata.sessionId !== sessionId) {
            throw new Error(
                `Blob with id ${blobId} not found in session ${sessionId}`,
            );
        }

        try {
            const db = await this.openIndexedDB();
            const transaction = db.transaction(
                ["audioBlobs", "sessions"],
                "readwrite",
            );

            return new Promise((resolve, reject) => {
                // Delete blob
                const blobStore = transaction.objectStore("audioBlobs");
                const blobDeleteRequest = blobStore.delete(blobId);

                blobDeleteRequest.onsuccess = () => {
                    // Update session metadata
                    session.blobCount -= 1;
                    session.totalSize -= metadata.size;
                    session.updatedAt = new Date();

                    const sessionStore = transaction.objectStore("sessions");
                    const sessionPutRequest = sessionStore.put({
                        ...session,
                        createdAt: session.createdAt.toISOString(),
                        updatedAt: session.updatedAt.toISOString(),
                    });

                    sessionPutRequest.onsuccess = () => {
                        // Update in-memory data
                        this.blobMetadata.delete(blobId);
                        this.sessions.set(sessionId, { ...session });
                        resolve(true);
                    };
                    sessionPutRequest.onerror = () =>
                        reject(sessionPutRequest.error);
                };
                blobDeleteRequest.onerror = () =>
                    reject(blobDeleteRequest.error);
            });
        } catch (err) {
            console.error("Failed to delete blob:", err);
            throw new Error("Failed to delete audio blob");
        }
    }

    // Get all sessions
    getAllSessions(): AudioSession[] {
        return Array.from(this.sessions.values()).sort(
            (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
        );
    }

    // Get session by ID
    getSession(sessionId: string): AudioSession | null {
        return this.sessions.get(sessionId) ?? null;
    }

    // Update session name
    async updateSessionName(sessionId: string, name: string): Promise<boolean> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session with id ${sessionId} not found`);
        }

        session.name = name;
        session.updatedAt = new Date();
        this.sessions.set(sessionId, { ...session });

        try {
            const db = await this.openIndexedDB();
            const transaction = db.transaction(["sessions"], "readwrite");
            const store = transaction.objectStore("sessions");
            await store.put({
                ...session,
                createdAt: session.createdAt.toISOString(),
                updatedAt: session.updatedAt.toISOString(),
            });
        } catch (err) {
            console.warn("Failed to update session name in IndexedDB:", err);
        }

        return true;
    }

    // Clear all sessions and blobs
    async clearAllSessions(): Promise<void> {
        try {
            const db = await this.openIndexedDB();
            const transaction = db.transaction(
                ["sessions", "audioBlobs"],
                "readwrite",
            );

            return new Promise((resolve, reject) => {
                const sessionStore = transaction.objectStore("sessions");
                const blobStore = transaction.objectStore("audioBlobs");

                const sessionClearRequest = sessionStore.clear();
                const blobClearRequest = blobStore.clear();

                let completed = 0;
                const checkComplete = () => {
                    completed++;
                    if (completed === 2) {
                        // Clear memory
                        this.sessions.clear();
                        this.blobMetadata.clear();
                        resolve();
                    }
                };

                sessionClearRequest.onsuccess = checkComplete;
                blobClearRequest.onsuccess = checkComplete;

                sessionClearRequest.onerror = () =>
                    reject(sessionClearRequest.error);
                blobClearRequest.onerror = () => reject(blobClearRequest.error);
            });
        } catch (err) {
            console.error("Failed to clear storage:", err);
            throw new Error("Failed to clear all data");
        }
    }

    // Load sessions and blob metadata from IndexedDB on startup
    async loadFromIndexedDB(): Promise<void> {
        try {
            const db = await this.openIndexedDB();
            const transaction = db.transaction(
                ["sessions", "audioBlobs"],
                "readonly",
            );

            // Load sessions
            const sessionStore = transaction.objectStore("sessions");
            const sessionRequest = sessionStore.getAll();

            // Load blob metadata (without blob data)
            const blobStore = transaction.objectStore("audioBlobs");
            const blobRequest = blobStore.getAll();

            await Promise.all([
                new Promise<void>((resolve, reject) => {
                    sessionRequest.onsuccess = () => {
                        sessionRequest.result.forEach(
                            (sessionData: StoredAudioSession) => {
                                const session: AudioSession = {
                                    ...sessionData,
                                    createdAt: new Date(sessionData.createdAt),
                                    updatedAt: new Date(sessionData.updatedAt),
                                };
                                this.sessions.set(session.id, session);
                            },
                        );
                        resolve();
                    };
                    sessionRequest.onerror = () => reject(sessionRequest.error);
                }),
                new Promise<void>((resolve, reject) => {
                    blobRequest.onsuccess = () => {
                        blobRequest.result.forEach(
                            (blobData: StoredAudioBlob) => {
                                // Only store metadata, not the actual blob data
                                const metadata: AudioBlobMetadata = {
                                    id: blobData.id,
                                    sessionId: blobData.sessionId,
                                    createdAt: new Date(blobData.createdAt),
                                    name: blobData.name,
                                    size: blobData.size,
                                    type: blobData.type,
                                    duration: blobData.duration,
                                };
                                this.blobMetadata.set(metadata.id, metadata);
                            },
                        );
                        resolve();
                    };
                    blobRequest.onerror = () => reject(blobRequest.error);
                }),
            ]);
        } catch (err) {
            console.warn("Failed to load from IndexedDB:", err);
        }
    }

    // Get computed statistics
    get sessionCount(): number {
        return this.sessions.size;
    }

    get totalBlobCount(): number {
        return this.blobMetadata.size;
    }

    get totalStorageSize(): number {
        let size = 0;
        this.sessions.forEach((session) => {
            size += session.totalSize;
        });
        return size;
    }
}

// Utility function to create a singleton instance
let audioStorageInstance: AudioStorageService | null = null;

export function createAudioStorage(
    options?: AudioStorageOptions,
): AudioStorageService {
    if (!audioStorageInstance) {
        audioStorageInstance = new AudioStorageService(options);
    }
    return audioStorageInstance;
}

export function getAudioStorage(): AudioStorageService {
    if (!audioStorageInstance) {
        audioStorageInstance = new AudioStorageService();
    }
    return audioStorageInstance;
}
