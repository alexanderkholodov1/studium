// The queue of material for the person's AI. Any amount of files waits here, part by part, and survives a reload, a
// closed tab or a crash: its state and, when the browser has room, its files live in this browser (IndexedDB, through
// the store given to it). Pure: the store, the preparation and the AI are given to it, so it is tested in Node
// (tools/test-queue.mjs) with a store in memory.
//
// A group is one file (or the photos of one exam, or the code of one folder) with the form's values when it was
// dropped. A job is one part of a group: one request to the AI, one contribution to review. A job is:
// - waiting: for its turn, or until retryAt (a rate limit, a daily limit, a retry);
// - running: with the AI now;
// - done: the AI answered; its answer waits for review (result);
// - manual: for the chat: the person takes it to their AI and pastes the answer;
// - missing: its files were not kept (no room) and must be dropped again;
// - error: it failed for good; the person may retry it;
// - off: not chosen (a chapter of a book, a file already in the map);
// - published / discarded: reviewed.
//
// The errors of the AI carry a kind (aierror.js): rate and daily wait, transient retries a few times, account stops
// the queue until the person acts, anything else fails that job only.

const RETRIES = 4;
const BACKOFF = 15_000;

export function createQueue({ store, process, now = () => Date.now(), timers = globalThis, onChange = () => {}, backoff = BACKOFF }) {
  const groups = new Map();
  const jobs = new Map();
  const files = new Map(); // group id -> its File objects, while this page lives
  let looping = false;
  let wake = null;
  let order = 0;
  const status = { paused: false, stopped: '', note: '', waitUntil: 0, running: '', progress: '' };
  const changed = (what = {}) => onChange({ ...what, status: { ...status } });
  const save = (job) => store.putJob(job);

  const sorted = () => [...jobs.values()].sort((a, b) => a.order - b.order);
  const due = (j) => j.state === 'waiting' && (j.retryAt ?? 0) <= now();
  function sleep(ms) {
    return new Promise((resolve) => {
      const t = timers.setTimeout(() => { wake = null; resolve(); }, Math.max(0, ms));
      wake = () => { timers.clearTimeout(t); wake = null; resolve(); };
    });
  }
  const poke = () => wake?.();

  const api = {
    // What the store holds (also what another tab changed). The part this tab is running keeps its own state.
    async load() {
      const all = await store.getAll();
      groups.clear();
      for (const g of all.groups) groups.set(g.id, g);
      const mine = jobs.get(status.running);
      for (const id of [...jobs.keys()]) if (id !== status.running) jobs.delete(id);
      for (const j of all.jobs) {
        if (j.id === status.running && mine) continue;
        jobs.set(j.id, j);
        order = Math.max(order, j.order ?? 0);
      }
      // Jobs of a group whose files were not kept cannot go on until the person drops them again.
      for (const j of jobs.values()) {
        const g = groups.get(j.gid);
        if (j.state === 'waiting' && g && !g.stored && !files.has(g.id)) { j.state = 'missing'; await save(j); }
      }
      changed();
    },
    groups: () => [...groups.values()],
    jobs: sorted,
    group: (gid) => groups.get(gid),
    job: (id) => jobs.get(id),
    status: () => ({ ...status }),
    // The prints of what waits or was done in this queue: the same file is never queued twice.
    prints: () => new Set([...groups.values()].map((g) => g.print).filter(Boolean)),
    counts() {
      const c = { total: 0, done: 0, waiting: 0, running: 0, manual: 0, error: 0, missing: 0, off: 0, reviewed: 0 };
      for (const j of jobs.values()) {
        if (j.state === 'off') { c.off += 1; continue; }
        c.total += 1;
        if (j.state === 'published' || j.state === 'discarded') { c.reviewed += 1; c.done += 1; } else if (j.state in c) c[j.state] += 1;
      }
      return c;
    },
    // The files of a group: those dropped in this page, or those the store kept.
    async filesOf(gid) {
      if (files.has(gid)) return files.get(gid);
      const kept = await store.getFiles(gid);
      if (kept) files.set(gid, kept);
      return kept;
    },
    // A group and its parts. units: [{ label, note, stage, print, on }]. manual: for the chat, without an AI.
    async add({ zone = 'material', name, code = false, print = '', v = {}, list = [], units, manual = false }) {
      const id = `g${now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      const g = { id, zone, name, code, print, v, created: now(), stored: false };
      files.set(id, list);
      g.stored = list.length ? await store.putFiles(id, list).catch(() => false) : true;
      groups.set(id, g);
      await store.putGroup(g);
      const added = [];
      for (const [index, u] of units.entries()) {
        order += 1;
        const j = { id: `${id}-${index}`, gid: id, index, order, label: u.label, note: u.note ?? '', stage: u.stage ?? '', print: u.print ?? '',
          state: u.on ? (manual ? 'manual' : 'waiting') : 'off', attempts: 0, retryAt: 0, error: '', result: null };
        jobs.set(j.id, j);
        await save(j);
        added.push(j);
      }
      changed({ added: g });
      if (!manual) api.start();
      return { group: g, jobs: added };
    },
    // The same file dropped again brings back the parts that were missing it. Returns whether it matched.
    async attach(print, list) {
      const g = [...groups.values()].find((x) => x.print && x.print === print);
      if (!g) return false;
      files.set(g.id, list);
      for (const j of jobs.values()) if (j.gid === g.id && j.state === 'missing') { j.state = 'waiting'; j.error = ''; await save(j); }
      changed();
      api.start();
      return true;
    },
    // A part chosen or not (a chapter of a book).
    async choose(id, on, manual = false) {
      const j = jobs.get(id);
      if (!j || !['off', 'waiting', 'manual', 'error'].includes(j.state)) return;
      j.state = on ? (manual ? 'manual' : 'waiting') : 'off';
      j.retryAt = 0; j.attempts = 0; j.error = '';
      await save(j); changed();
      if (on && !manual) api.start();
    },
    async retry(id) { const j = jobs.get(id); if (j && (j.state === 'error' || j.state === 'manual')) { j.state = 'waiting'; j.attempts = 0; j.retryAt = 0; j.error = ''; await save(j); changed(); api.start(); } },
    async retryFailed() { for (const j of jobs.values()) if (j.state === 'error') { j.state = 'waiting'; j.attempts = 0; j.retryAt = 0; j.error = ''; await save(j); } changed(); api.start(); },
    // A part for the chat: the person takes it to their AI.
    async toChat(id) { const j = jobs.get(id); if (j && ['error', 'waiting', 'missing'].includes(j.state)) { j.state = 'manual'; j.retryAt = 0; await save(j); changed(); } },
    // The answer the person pasted from their chat.
    async answer(id, text) {
      const j = jobs.get(id);
      if (!j || !String(text ?? '').trim()) return null;
      j.state = 'done'; j.error = ''; j.result = { text: String(text), provider: '', model: '', effort: '', way: 'chat' };
      await save(j); changed({ done: j });
      return j;
    },
    async reviewed(id, outcome) { const j = jobs.get(id); if (j && j.state === 'done') { j.state = outcome; j.result = null; await save(j); changed(); } },
    pause() { status.paused = true; changed(); poke(); },
    // «Seguir»: also now, without waiting for a limit, when the person changed the AI or opened the bridge again.
    async resume() {
      status.paused = false; status.stopped = ''; status.waitUntil = 0; status.note = '';
      for (const j of jobs.values()) if (j.state === 'waiting' && j.retryAt) { j.retryAt = 0; await save(j); }
      changed();
      api.start();
      poke();
    },
    // What is reviewed, not chosen or empty leaves the list; a group with nothing left leaves with its files.
    async clearFinished() {
      for (const j of [...jobs.values()]) if (['published', 'discarded', 'off'].includes(j.state)) { jobs.delete(j.id); await store.deleteJob(j.id); }
      for (const g of [...groups.values()]) {
        if ([...jobs.values()].some((j) => j.gid === g.id)) continue;
        groups.delete(g.id); files.delete(g.id); await store.deleteGroup(g.id);
      }
      changed();
    },
    // Runs the waiting parts one after the other. lock(fn) runs fn only in the one tab that holds the queue.
    start(lock = api.lock) {
      if (looping || status.paused || status.stopped) return;
      looping = true;
      Promise.resolve(lock ? lock(loop) : loop()).catch(() => {}).finally(() => { looping = false; status.running = ''; changed(); });
    },
    lock: null,
    setProgress(id, text) { if (status.running === id) { status.progress = text; changed({ progress: id }); } },
  };

  async function loop() {
    // Only the tab that holds the queue gets here: a part left running by a page that closed or crashed waits again.
    await api.load();
    for (const j of jobs.values()) if (j.state === 'running') { j.state = 'waiting'; await save(j); }
    for (;;) {
      if (status.paused || status.stopped) return;
      const job = sorted().find(due);
      if (!job) {
        const later = sorted().filter((j) => j.state === 'waiting').map((j) => j.retryAt ?? 0);
        if (!later.length) { status.note = ''; status.waitUntil = 0; return; }
        const until = Math.min(...later);
        status.waitUntil = until;
        changed();
        await sleep(until - now());
        continue;
      }
      const g = groups.get(job.gid);
      const list = await api.filesOf(job.gid);
      if (!g || !list) { job.state = 'missing'; await save(job); changed(); continue; }
      job.state = 'running'; status.running = job.id; status.progress = ''; status.note = ''; status.waitUntil = 0;
      await save(job); changed();
      try {
        const result = await process(job, g, list);
        job.state = 'done'; job.result = result; job.error = ''; job.attempts = 0;
        await save(job); changed({ done: job });
      } catch (e) {
        const kind = e?.kind ?? 'job';
        job.error = String(e?.message ?? e);
        if (kind === 'rate' || kind === 'daily') {
          job.state = 'waiting'; job.retryAt = e.retryAt || now() + backoff;
          status.note = job.error;
          // A daily limit holds every part: they all go to the same AI.
          if (kind === 'daily') for (const j of jobs.values()) if (j.state === 'waiting') j.retryAt = Math.max(j.retryAt ?? 0, job.retryAt);
        } else if (kind === 'transient') {
          job.attempts += 1;
          if (job.attempts >= RETRIES) job.state = 'error';
          else { job.state = 'waiting'; job.retryAt = now() + backoff * 2 ** (job.attempts - 1); }
        } else if (kind === 'account' || kind === 'cancel') {
          job.state = 'waiting'; job.retryAt = 0;
          if (kind === 'account') status.stopped = job.error; else status.paused = true;
        } else {
          job.state = 'error';
        }
        await save(job);
        if (kind === 'daily') for (const j of jobs.values()) if (j.state === 'waiting') await save(j);
        changed({ failed: job, kind });
      } finally { status.running = ''; status.progress = ''; }
    }
  }
  return api;
}

/* ---------- the stores ---------- */
// In memory: for the tests, and when the browser offers no IndexedDB (a private window may not).
export function memoryStore({ room = Infinity } = {}) {
  const groups = new Map(); const jobs = new Map(); const kept = new Map();
  let used = 0;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  return {
    async getAll() { return { groups: [...groups.values()].map(clone), jobs: [...jobs.values()].map(clone) }; },
    async putGroup(g) { groups.set(g.id, clone(g)); },
    async putJob(j) { jobs.set(j.id, clone(j)); },
    async deleteJob(id) { jobs.delete(id); },
    async deleteGroup(id) { groups.delete(id); const k = kept.get(id); if (k) used -= k.size; kept.delete(id); },
    async putFiles(id, list) {
      const size = list.reduce((s, f) => s + (f.size ?? 0), 0);
      if (used + size > room) return false;
      kept.set(id, { list, size }); used += size; return true;
    },
    async getFiles(id) { return kept.get(id)?.list ?? null; },
  };
}

// IndexedDB: the queue and its files survive the page. Files are kept as blobs with their path in the dropped folder;
// when the browser has no room for them, the queue keeps its place and asks for them again.
export function indexedStore(name = 'studium-queue') {
  let db = null;
  const open = () => (db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const s of ['groups', 'jobs', 'files']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { db = null; reject(req.error); };
  }));
  const tx = async (stores, mode, fn) => {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction(stores, mode);
      let out;
      Promise.resolve(fn(t)).then((v) => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  const all = (t, s) => new Promise((resolve, reject) => { const r = t.objectStore(s).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const plain = (x) => JSON.parse(JSON.stringify(x));
  return {
    async getAll() { return tx(['groups', 'jobs'], 'readonly', async (t) => { const g = all(t, 'groups'); const j = all(t, 'jobs'); return { groups: await g, jobs: await j }; }); },
    putGroup: (g) => tx(['groups'], 'readwrite', (t) => { t.objectStore('groups').put(plain(g)); }),
    putJob: (j) => tx(['jobs'], 'readwrite', (t) => { t.objectStore('jobs').put(plain(j)); }),
    deleteJob: (id) => tx(['jobs'], 'readwrite', (t) => { t.objectStore('jobs').delete(id); }),
    deleteGroup: (id) => tx(['groups', 'files'], 'readwrite', (t) => { t.objectStore('groups').delete(id); t.objectStore('files').delete(id); }),
    async putFiles(id, list) {
      try {
        // Asked once: a persistent store is not cleared by the browser when space runs low.
        await navigator.storage?.persist?.().catch(() => false);
        const est = await navigator.storage?.estimate?.().catch(() => null);
        const size = list.reduce((s, f) => s + f.size, 0);
        if (est && est.quota - est.usage < size * 1.2) return false;
        await tx(['files'], 'readwrite', (t) => { t.objectStore('files').put({ id, list: list.map((f) => ({ blob: f, name: f.name, path: f.webkitRelativePath || f.relativePath || f.name, type: f.type, modified: f.lastModified })) }); });
        return true;
      } catch { return false; }
    },
    async getFiles(id) {
      const rec = await tx(['files'], 'readonly', (t) => new Promise((resolve) => { const r = t.objectStore('files').get(id); r.onsuccess = () => resolve(r.result ?? null); r.onerror = () => resolve(null); }));
      if (!rec) return null;
      return rec.list.map((x) => { const f = new File([x.blob], x.name, { type: x.type, lastModified: x.modified }); f.relativePath = x.path; return f; });
    },
  };
}
