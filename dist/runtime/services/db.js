import Dexie from "dexie";
const db = new Dexie("AudioRecorderDB");
db.version(1).stores({
  audioBlobs: "id, sessionId, createdAt, name, size, type",
  audioSessions: "id, createdAt, updatedAt, blobCount, totalSize"
});
export { db };
