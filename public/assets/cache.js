// What this browser keeps between visits, in IndexedDB: the last pack of contributions, so a visit only reads what
// changed. Nothing here is personal, and when IndexedDB is not available (a private window) nothing is kept.
const DB = 'studium';
const STORE = 'kv';
let opening = null;

function open() {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return opening;
}
function run(mode, fn) {
  return open().then((db) => new Promise((resolve) => {
    if (!db) { resolve(undefined); return; }
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch { resolve(undefined); }
  }));
}
export const cache = {
  get: (key) => run('readonly', (s) => s.get(key)),
  set: (key, value) => run('readwrite', (s) => s.put(value, key)),
  remove: (key) => run('readwrite', (s) => s.delete(key)),
};
