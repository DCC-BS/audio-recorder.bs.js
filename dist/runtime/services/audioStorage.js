import { db } from "./db.js";
export class AudioStorageService {
  // Generate unique ID
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
  async createSession(name) {
    const id = this.generateId();
    const now = new Date(Date.now()).toISOString();
    await db.audioSessions.add({
      id,
      name,
      createdAt: now,
      blobCount: 0,
      totalSize: 0,
      blobIds: []
    });
    return id;
  }
  async storeAudioBlob(sessionId, blob, name, duration) {
    const id = this.generateId();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const session = await db.audioSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session with ID ${sessionId} not found`);
    }
    await db.transaction(
      "rw",
      db.audioBlobs,
      db.audioSessions,
      async () => {
        await db.audioBlobs.add({
          id,
          sessionId,
          createdAt: now,
          duration,
          name,
          size: blob.size,
          type: blob.type,
          blob
        });
        session.blobCount += 1;
        session.totalSize += blob.size;
        session.blobIds.push(id);
        await db.audioSessions.put(session);
      }
    );
    return id;
  }
  async getSessionBlobs(sessionId) {
    const blobs = await db.audioBlobs.where("sessionId").equals(sessionId).toArray();
    return blobs.map((b) => b.blob);
  }
  async getAllSessions() {
    const sessions = await db.audioSessions.where("blobCount").aboveOrEqual(1).toArray();
    return sessions;
  }
  async deleteSession(sessionId) {
    const session = await db.audioSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session with ID ${sessionId} not found`);
    }
    await db.transaction(
      "rw",
      db.audioBlobs,
      db.audioSessions,
      async () => {
        await db.audioBlobs.where("sessionId").equals(sessionId).delete();
        await db.audioSessions.delete(sessionId);
      }
    );
  }
  async clearSessionOverThreshold(maxSessions) {
    const sessions = await db.audioSessions.where("blobCount").aboveOrEqual(1).sortBy("createdAt");
    if (sessions.length <= maxSessions) {
      return;
    }
    const sessionsToDelete = sessions.slice(0, sessions.length - maxSessions);
    for (const session of sessionsToDelete) {
      await this.deleteSession(session.id);
    }
  }
  async clearSessionsOlderThan(days) {
    const cutoffDateUTC = Date.now();
    const cutoffDate = new Date(cutoffDateUTC - days * 24 * 60 * 60 * 1e3);
    const cutoffIso = cutoffDate.toISOString();
    const oldSessions = await db.audioSessions.where("createdAt").below(cutoffIso).toArray();
    for (const session of oldSessions) {
      await this.deleteSession(session.id);
    }
  }
}
