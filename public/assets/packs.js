// Packs: every public contribution in a few documents, so a visit reads a handful of documents instead of one per
// contribution, and stays within the free plan as the map grows. An admin compiles them on demand (the admin panel, or
// tools/compile-packs.mjs after an upload); nothing compiles them on a timer. Contributions published after the last
// pack are read one by one, and those deleted or made private after it leave a record in removed/, so the map is never
// stale. Pure functions: the browser and the tools share them.

// One part of a pack: a Firestore document holds at most 1 MiB, and this leaves room for its other fields.
export const PART_BYTES = 850_000;

// The fields of a contribution document a pack keeps (everything but its compressed body, which goes in as data).
export const FIELDS = ['kind', 'course', 'code', 'university', 'term', 'professor', 'title', 'stage', 'theme', 'source', 'print', 'concepts', 'questions', 'examples', 'visibility'];

// items: [{ id, updated (milliseconds), data (the body), ...FIELDS }]. The JSON a pack holds, before compression.
export function packJSON(build, items) {
  const keep = items.filter((x) => x.visibility === 'public').map((x) => {
    const out = { id: x.id, updated: x.updated, data: x.data };
    for (const k of FIELDS) if (x[k] !== undefined && x[k] !== '') out[k] = x[k];
    return out;
  }).sort((a, b) => a.updated - b.updated || a.id.localeCompare(b.id));
  return JSON.stringify({ studium: 'pack', version: 1, build, items: keep });
}
export function readPack(json) {
  const obj = JSON.parse(json);
  if (obj?.studium !== 'pack' || !Array.isArray(obj.items)) throw new Error('not-a-pack');
  return obj.items.map((x) => ({ type: 'contribution', visibility: 'public', ...x }));
}
// Compressed bytes in parts of at most PART_BYTES, and back.
export function slices(bytes, size = PART_BYTES) {
  const out = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size));
  return out.length ? out : [new Uint8Array(0)];
}
export function join(parts) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
// A build id: the time of the compilation and a short random tail.
export const buildId = (now = Date.now()) => `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// The map's contributions: the pack's, then the ones published after it, minus those removed after their last change.
export function merge(packItems, fresh, removed) {
  const byId = new Map(packItems.map((x) => [x.id, x]));
  for (const x of fresh) byId.set(x.id, x);
  for (const [id, at] of removed) {
    const x = byId.get(id);
    if (x && at >= (x.updated || 0)) byId.delete(id);
  }
  return [...byId.values()];
}
