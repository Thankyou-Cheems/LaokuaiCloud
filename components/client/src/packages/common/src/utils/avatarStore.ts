type StoredAvatarV1 = {
  blob: Blob;
  mime: string | null;
  updatedAt: number;
};

const DB_NAME = "gryt";
const DB_VERSION = 1;
const STORE_NAME = "kv";

function avatarKey(userId: string): string {
  return `avatar:v1:${userId}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open IndexedDB"));
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error || new Error("IndexedDB get failed"));
    tx.oncomplete = () => db.close();
  });
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error("IndexedDB put failed"));
    tx.oncomplete = () => db.close();
  });
}

async function idbDel(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error("IndexedDB delete failed"));
    tx.oncomplete = () => db.close();
  });
}

export async function getStoredAvatar(userId: string): Promise<StoredAvatarV1 | null> {
  // Try user-scoped key first, fall back to legacy global key for migration
  const result = await idbGet<StoredAvatarV1>(avatarKey(userId));
  if (result) return result;

  const legacy = await idbGet<StoredAvatarV1>("avatar:v1");
  if (legacy) {
    await idbSet(avatarKey(userId), legacy);
    await idbDel("avatar:v1").catch(() => {});
    return legacy;
  }
  return null;
}

export async function setStoredAvatar(userId: string, blob: Blob, mime?: string | null): Promise<void> {
  const rec: StoredAvatarV1 = {
    blob,
    mime: typeof mime === "string" ? mime : (blob.type || null),
    updatedAt: Date.now(),
  };
  await idbSet(avatarKey(userId), rec);
}

export async function clearStoredAvatar(userId: string): Promise<void> {
  await idbDel(avatarKey(userId));
}

export async function getAvatarHash(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
