// Tests the queue of material (public/assets/queue.js) with a store in memory and a fake AI, and what each
// provider's error means (public/assets/aierror.js): a reload in the middle, rate and daily limits, an account without
// balance, retries, files the browser had no room for, the chat, two tabs at once.
// node tools/test-queue.mjs
import { createQueue, memoryStore } from '../public/assets/queue.js';
import { classify, nextMidnight } from '../public/assets/aierror.js';

const results = [];
const check = (cond, what) => { if (!cond) throw new Error(what); };
async function test(name, fn) { try { await fn(); results.push([true, name]); } catch (e) { results.push([false, `${name}: ${e.message}`]); } }
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(cond, what, ms = 3000) { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await tick(5); } }
const fail = (kind, message, retryAt = 0) => Object.assign(new Error(message), { kind, retryAt });
const file = (name, size = 10) => ({ name, size });
const units = (n, on = true) => Array.from({ length: n }, (_, i) => ({ label: `parte ${i + 1}`, on, print: `p${i}` }));
function queueWith(store, process, extra = {}) {
  return createQueue({ store, process, backoff: 20, ...extra });
}

/* ---------- the queue ---------- */
await test('runs every part in order and keeps each answer', async () => {
  const seen = [];
  const q = queueWith(memoryStore(), async (job) => { seen.push(job.label); return { text: `ok ${job.label}` }; });
  await q.load();
  await q.add({ name: 'examen.pdf', print: 'f1', list: [file('examen.pdf')], units: units(3) });
  await until(() => q.counts().done === 3, 'three done');
  check(seen.join() === 'parte 1,parte 2,parte 3', seen.join());
  check(q.jobs().every((j) => j.result.text.startsWith('ok')), 'answers kept');
});
await test('a reload in the middle resumes the part that was running', async () => {
  const store = memoryStore();
  const a = queueWith(store, () => new Promise(() => {})); // the page closes while the AI reads
  await a.load();
  await a.add({ name: 'libro.pdf', print: 'f2', list: [file('libro.pdf')], units: units(2) });
  await until(() => a.jobs()[0].state === 'running', 'first running');
  const b = queueWith(store, async () => ({ text: 'ok' }));
  await b.load(); // the new page: its files are kept by the store
  // Only the tab that takes the queue puts the interrupted part back in line, and then runs it.
  b.start();
  await until(() => b.jobs()[0].state !== 'running', 'the interrupted part goes back in line');
  await until(() => b.counts().done === 2, 'both done after the reload');
});
await test('a rate limit waits as long as the provider says, then goes on', async () => {
  let calls = 0;
  const q = queueWith(memoryStore(), async () => { calls += 1; if (calls === 1) throw fail('rate', 'pausa', Date.now() + 60); return { text: 'ok' }; });
  await q.load();
  const t0 = Date.now();
  await q.add({ name: 'a.pdf', print: 'f3', list: [file('a.pdf')], units: units(1) });
  await until(() => q.counts().done === 1, 'done after the wait');
  check(Date.now() - t0 >= 55, `waited only ${Date.now() - t0} ms`);
});
await test('a daily limit holds every part until its reset', async () => {
  let calls = 0; let resetAt = 0;
  const q = queueWith(memoryStore(), async () => { calls += 1; if (calls === 1) { resetAt = Date.now() + 120; throw fail('daily', 'Usaste los pedidos de hoy', resetAt); } return { text: 'ok' }; });
  await q.load();
  await q.add({ name: 'b.pdf', print: 'f4', list: [file('b.pdf')], units: units(3) });
  await until(() => q.status().waitUntil > 0, 'waiting for the reset');
  await tick(40);
  check(calls === 1, `ran ${calls} before the reset`);
  check(q.jobs().every((j) => j.state === 'waiting' && j.retryAt >= resetAt), 'all held');
  await until(() => q.counts().done === 3, 'all done after the reset');
});
await test('an account problem stops the queue until the person acts', async () => {
  let broke = true;
  const q = queueWith(memoryStore(), async () => { if (broke) throw fail('account', 'Tu cuenta no tiene saldo'); return { text: 'ok' }; });
  await q.load();
  await q.add({ name: 'c.pdf', print: 'f5', list: [file('c.pdf')], units: units(2) });
  await until(() => q.status().stopped, 'stopped');
  check(q.status().stopped === 'Tu cuenta no tiene saldo', q.status().stopped);
  check(q.counts().waiting === 2, 'both still waiting');
  broke = false;
  await q.resume();
  await until(() => q.counts().done === 2, 'done after «Seguir»');
});
await test('network failures retry with growing waits, then give up', async () => {
  let calls = 0;
  const q = queueWith(memoryStore(), async (job) => { calls += 1; if (job.index === 0 && calls < 3) throw fail('transient', 'sin red'); if (job.index === 1) throw fail('transient', 'sin red'); return { text: 'ok' }; });
  await q.load();
  await q.add({ name: 'd.pdf', print: 'f6', list: [file('d.pdf')], units: units(2) });
  await until(() => q.jobs()[1].state === 'error', 'second gave up', 5000);
  check(q.jobs()[0].state === 'done', `first ${q.jobs()[0].state}`);
  check(q.jobs()[1].attempts === 4, `attempts ${q.jobs()[1].attempts}`);
});
await test('a part that cannot be done fails alone; the rest goes on', async () => {
  const q = queueWith(memoryStore(), async (job) => { if (job.index === 0) throw fail('job', 'demasiado grande'); return { text: 'ok' }; });
  await q.load();
  await q.add({ name: 'e.pdf', print: 'f7', list: [file('e.pdf')], units: units(3) });
  await until(() => q.counts().done === 2, 'two done');
  check(q.jobs()[0].state === 'error' && q.jobs()[0].error === 'demasiado grande', q.jobs()[0].state);
  await q.retryFailed();
  check(q.jobs()[0].state !== 'error', 'retried');
});
await test('files the browser had no room for are asked again, and the same file brings the parts back', async () => {
  const store = memoryStore({ room: 0 });
  const a = queueWith(store, () => new Promise(() => {}));
  await a.load();
  await a.add({ name: 'grande.pdf', print: 'f8', list: [file('grande.pdf', 5)], units: units(2) });
  const b = queueWith(store, async () => ({ text: 'ok' }));
  await b.load();
  b.start(); // the tab that runs the queue finds no file for them
  await until(() => b.jobs().every((j) => j.state === 'missing'), 'both missing their file');
  check(await b.attach('f8', [file('grande.pdf', 5)]), 'matched by fingerprint');
  await until(() => b.counts().done === 2, 'done after dropping it again');
});
await test('parts for the chat wait for the pasted answer', async () => {
  const q = queueWith(memoryStore(), async () => { throw new Error('must not run'); });
  await q.load();
  await q.add({ name: 'f.pdf', print: 'f9', list: [file('f.pdf')], units: units(2), manual: true });
  check(q.jobs().every((j) => j.state === 'manual'), 'manual');
  await q.answer(q.jobs()[0].id, '{"concepts":[]}');
  check(q.jobs()[0].state === 'done' && q.jobs()[0].result.way === 'chat', 'answered');
  check(q.counts().manual === 1, 'one left');
});
await test('two tabs never run the same part twice', async () => {
  const store = memoryStore();
  let held = false;
  const lock = async (fn) => { if (held) return false; held = true; try { return await fn(); } finally { held = false; } };
  const ran = [];
  const process = async (job) => { ran.push(job.id); await tick(10); return { text: 'ok' }; };
  const a = queueWith(store, process); a.lock = lock;
  const b = queueWith(store, process); b.lock = lock;
  await a.load();
  await a.add({ name: 'g.pdf', print: 'f10', list: [file('g.pdf')], units: units(4) });
  await b.load(); b.start();
  await until(() => a.counts().done === 4, 'a did all');
  check(new Set(ran).size === ran.length && ran.length === 4, ran.join());
});
await test('chapters not chosen wait; choosing one runs it; finished work leaves the list', async () => {
  const q = queueWith(memoryStore(), async () => ({ text: 'ok' }));
  await q.load();
  await q.add({ name: 'libro.pdf', print: 'f11', list: [file('libro.pdf')], units: [{ label: 'índice', on: true }, { label: 'cap. 1', on: false }, { label: 'cap. 2', on: false }] });
  await until(() => q.counts().done === 1, 'index done');
  check(q.counts().off === 2, 'two not chosen');
  await q.choose(q.jobs()[1].id, true);
  await until(() => q.counts().done === 2, 'chapter done');
  check(q.prints().has('f11'), 'its print is known');
  for (const j of q.jobs().filter((x) => x.state === 'done')) await q.reviewed(j.id, 'published');
  await q.clearFinished();
  check(q.jobs().length === 0 && q.groups().length === 0, 'all cleared');
});

await test('a part dropped while the loop reads the store is not lost', async () => {
  const store = memoryStore();
  let release;
  const gate = new Promise((r) => { release = r; });
  // The store's first read is slow: a second file arrives meanwhile.
  const slow = { ...store, getAll: async () => { const snap = await store.getAll(); await gate; return snap; } };
  const q = queueWith(slow, async () => ({ text: 'ok' }));
  await q.add({ name: 'uno.txt', print: 'r1', list: [file('uno.txt')], units: units(1) });
  await q.add({ name: 'dos.txt', print: 'r2', list: [file('dos.txt')], units: units(1) });
  release();
  await until(() => q.counts().done === 2, 'both done');
});
await test('another tab\'s news never makes the running part run twice', async () => {
  const store = memoryStore();
  const ran = [];
  let q;
  q = queueWith(store, async (job) => {
    ran.push(job.id);
    // While the AI reads, the store still says «waiting» for an older copy, and another tab announces a change.
    await store.putJob({ ...job, state: 'waiting' });
    await q.load();
    await tick(10);
    return { text: 'ok' };
  });
  await q.add({ name: 'h.pdf', print: 'r3', list: [file('h.pdf')], units: units(2) });
  await until(() => q.counts().done === 2, 'both done');
  await tick(50);
  check(ran.length === 2 && new Set(ran).size === 2, ran.join());
});
await test('a tab that does not run the queue never marks parts as missing their file', async () => {
  const store = memoryStore({ room: 0 });
  const a = queueWith(store, () => new Promise(() => {}));
  await a.add({ name: 'i.pdf', print: 'r4', list: [file('i.pdf', 5)], units: units(2) });
  const b = queueWith(store, async () => ({ text: 'ok' }));
  await b.load();
  check(b.jobs().every((j) => j.state !== 'missing'), b.jobs().map((j) => j.state).join());
  const back = (await store.getAll()).jobs;
  check(back.every((j) => j.state !== 'missing'), 'saved as missing');
});

/* ---------- what the errors mean ---------- */
const now = Date.parse('2026-11-13T19:00:00Z');
await test('a claude.ai subscription without API balance says what to do instead', async () => {
  const e = classify({ way: 'anthropic', status: 400, message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.', now });
  check(e.kind === 'account' && /no incluye la API/.test(e.message) && /puente/.test(e.message), e.message);
});
await test('the daily limit of free Gemini resets at midnight in California', async () => {
  const e = classify({ way: 'gemini', status: 429, body: { error: { message: 'Quota exceeded for metric: generate_content_free_tier_requests', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }, now });
  check(e.kind === 'daily' && e.retryAt === Date.parse('2026-11-14T08:00:00Z'), `${e.kind} ${new Date(e.retryAt).toISOString()}`);
});
await test('a per-minute limit of Gemini waits what Google asks', async () => {
  const e = classify({ way: 'gemini', status: 429, body: { error: { message: 'Resource exhausted', details: [{ retryDelay: '37s' }] } }, now });
  check(e.kind === 'rate' && e.retryAt === now + 37000, `${e.kind} ${e.retryAt - now}`);
});
await test('OpenAI without balance, OpenRouter\'s free day, Puter used up', async () => {
  check(classify({ way: 'openai', status: 429, body: { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } }, now }).kind === 'account', 'openai');
  const r = classify({ way: 'openrouter', status: 429, message: 'Rate limit exceeded: free-models-per-day', now });
  check(r.kind === 'daily' && r.retryAt === Date.parse('2026-11-14T00:00:00Z'), `openrouter ${new Date(r.retryAt).toISOString()}`);
  check(classify({ way: 'puter', status: 402, body: { code: 'insufficient_funds' }, now }).kind === 'account', 'puter');
});
await test('the bridge: closed, re-paired, a CLI limit, a slow CLI', async () => {
  check(classify({ way: 'bridge:claude', status: 0, now }).kind === 'account', 'closed');
  check(classify({ way: 'bridge:claude', status: 401, now }).kind === 'account', 'code changed');
  const lim = classify({ way: 'bridge:claude', status: 429, body: { error: { code: 'limit', message: 'límite', resetsAt: '2026-11-13T22:00:00Z' } }, now });
  check(lim.kind === 'daily' && lim.retryAt === Date.parse('2026-11-13T22:00:00Z'), 'limit');
  check(classify({ way: 'bridge:codex', status: 504, now }).kind === 'transient', 'timeout');
  check(classify({ way: 'bridge:codex', status: 424, body: { error: { code: 'model', message: 'Codex no acepta ese modelo' } }, now }).message === 'Codex no acepta ese modelo', 'its own words');
});
await test('no connection, a provider down, a part too large', async () => {
  check(classify({ way: 'gemini', status: 0, now }).kind === 'transient', 'offline');
  check(classify({ way: 'anthropic', status: 529, message: 'Overloaded', now }).kind === 'transient', 'overloaded');
  check(classify({ way: 'openai', status: 413, now }).kind === 'job', 'too large');
});
await test('midnight in California across the change of hour', async () => {
  check(nextMidnight('America/Los_Angeles', Date.parse('2026-03-07T12:00:00Z')) === Date.parse('2026-03-08T08:00:00Z'), 'before the change');
  check(nextMidnight('America/Los_Angeles', Date.parse('2026-03-08T12:00:00Z')) === Date.parse('2026-03-09T07:00:00Z'), 'after the change');
  check(nextMidnight('UTC', Date.parse('2026-11-13T23:59:00Z')) === Date.parse('2026-11-14T00:00:00Z'), 'UTC');
});

for (const [ok, name] of results) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed} of ${results.length} passed`);
process.exit(failed ? 1 : 0);
