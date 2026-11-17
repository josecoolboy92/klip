// On-device storage (IndexedDB): your videos, photos and music, and your projects.
// Nothing is uploaded anywhere.

const DB_NAME = 'klip-studio';
const VERSION = 1;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // Ask the browser not to clear our storage when the phone runs low on space
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const req2promise = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export const db = {
  async all(store) {
    return tx(store, 'readonly', (s) => req2promise(s.getAll()));
  },
  async get(store, id) {
    return tx(store, 'readonly', (s) => req2promise(s.get(id)));
  },
  async put(store, value) {
    return tx(store, 'readwrite', (s) => req2promise(s.put(value)));
  },
  async del(store, id) {
    return tx(store, 'readwrite', (s) => req2promise(s.delete(id)));
  },
};

// Object URLs for stored files, created once and reused
const urlCache = new Map();
export function mediaUrl(media) {
  if (!media) return '';
  if (media.url && !media.blob) return media.url;
  if (!urlCache.has(media.id)) urlCache.set(media.id, URL.createObjectURL(media.blob));
  return urlCache.get(media.id);
}
export function forgetUrl(id) {
  if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
}

export async function storageEstimate() {
  try {
    const e = await navigator.storage.estimate();
    return { used: e.usage || 0, quota: e.quota || 0 };
  } catch {
    return null;
  }
}
