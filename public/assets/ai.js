// Bring your own AI, in several ways, as many at once as the person wants:
// - an API key of Claude, ChatGPT or Gemini (Gemini's is free within Google's daily limits);
// - the local bridge: the person's own Claude Code, Codex or Antigravity, signed in on their computer, with their
//   subscription instead of an API (bridge.mjs, which they download and run);
// - OpenRouter, signed in with one click (its free models cost nothing);
// - Puter, signed in with one click (its allowance pays).
// Without any of them, the chat: Studium copies the instructions and the person takes them to any chat by hand.
// Keys and sign-ins stay in this browser (localStorage); they never reach Studium's database. Studium charges nothing.
// Where, which model and which effort is chosen when the AI is used, for that task, and the page proposes the best of
// what this person has. The last choice per task is remembered.
import { settings } from './settings.js';
import { AIError, classify } from './aierror.js';

export { AIError };
const LOCAL = 'studium-ai';
const ANTHROPIC_SDK = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.5.0/+esm';
const PUTER_SDK = 'https://js.puter.com/v2/';
const OPENROUTER = 'https://openrouter.ai';
export const BRIDGE_PORT = 41730;
// The bridge file, from this same release.
export const BRIDGE_URL = new URL('./bridge.mjs', import.meta.url).href;

// Who makes each model: what a guide records as «hecha con».
export const PROVIDERS = {
  anthropic: { name: 'Claude', by: 'Anthropic', keyHint: 'sk-ant-…', keys: 'https://console.anthropic.com/settings/keys',
    tiers: { strong: 'claude-opus-5-5', mid: 'claude-sonnet-5-5', light: 'claude-haiku-5-5' } },
  openai: { name: 'ChatGPT', by: 'OpenAI', keyHint: 'sk-…', keys: 'https://platform.openai.com/api-keys', tiers: {} },
  gemini: { name: 'Gemini', by: 'Google', keyHint: 'AIza…', keys: 'https://aistudio.google.com/apikey', tiers: {} },
};
// The ways to reach an AI. offer: what the admins switch on or off (a provider of settings.providers, or a flag).
export const WAYS = {
  anthropic: { name: 'Claude', where: 'tu clave de API', vendor: 'anthropic', reads: { pdf: true, images: true }, offer: 'provider' },
  openai: { name: 'ChatGPT', where: 'tu clave de API', vendor: 'openai', reads: { pdf: true, images: true }, offer: 'provider' },
  gemini: { name: 'Gemini', where: 'tu clave de Google', vendor: 'gemini', reads: { pdf: true, images: true }, offer: 'provider' },
  'bridge:claude': { name: 'Claude Code', where: 'tu suscripción, en tu computadora', vendor: 'anthropic', engine: 'claude', offer: 'bridge' },
  'bridge:codex': { name: 'Codex', where: 'tu suscripción, en tu computadora', vendor: 'openai', engine: 'codex', offer: 'bridge' },
  'bridge:antigravity': { name: 'Antigravity', where: 'tu suscripción, en tu computadora', engine: 'antigravity', offer: 'bridge' },
  openrouter: { name: 'OpenRouter', where: 'tu cuenta de OpenRouter', reads: { pdf: true, images: true }, offer: 'openrouter' },
  puter: { name: 'Puter', where: 'tu cuenta de Puter', reads: { pdf: true, images: true }, offer: 'puter' },
};
export const EFFORTS = { low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto' };
// What each use of the AI needs, and what it recommends.
export const TASKS = {
  guide: { name: 'Crear una guía', tier: 'strong', effort: 'high', why: 'una guía completa merece el modelo más potente' },
  edit: { name: 'Editar una guía', tier: 'strong', effort: 'medium', why: 'cambiar una sección pide buen criterio, sin rehacer todo' },
  material: { name: 'Procesar material', tier: 'mid', effort: 'medium', why: 'leer apuntes y exámenes es trabajo de un modelo intermedio' },
  identify: { name: 'Identificar un documento', tier: 'light', effort: 'low', why: 'reconocer un sílabo o un enunciado basta con un modelo ligero' },
  ask: { name: 'Preguntarle al mapa', tier: 'light', effort: 'low', why: 'leer el índice del mapa y elegir qué mostrar es rápido para un modelo ligero' },
};
// Where each kind of task runs best, first to last: a subscription costs nothing per use and is the place for many
// files; the strongest models for a guide; a light, fast one for a quick question.
const ORDER = {
  strong: ['bridge:claude', 'anthropic', 'openai', 'puter', 'bridge:antigravity', 'bridge:codex', 'gemini', 'openrouter'],
  mid: ['bridge:claude', 'bridge:antigravity', 'gemini', 'anthropic', 'openai', 'bridge:codex', 'puter', 'openrouter'],
  light: ['gemini', 'anthropic', 'openai', 'openrouter', 'puter', 'bridge:claude', 'bridge:antigravity', 'bridge:codex'],
};
const WHY = {
  'bridge:claude': 'tu suscripción no cobra por uso y Claude lee los PDF tal como son',
  'bridge:antigravity': 'tu suscripción de Google no cobra por uso',
  'bridge:codex': 'tu suscripción de ChatGPT no cobra por uso',
  anthropic: 'tu clave cobra por uso, pero es rápida y lee cualquier archivo',
  openai: 'tu clave cobra por uso, pero es rápida y lee cualquier archivo',
  gemini: 'tu clave de Gemini es gratis dentro de los límites diarios de Google',
  openrouter: 'sus modelos gratis no cuestan nada, aunque aceptan pocos pedidos al día',
  puter: 'usa lo que tiene disponible tu cuenta de Puter',
};
// Claude models that accept the effort setting and the server-side fallback when a safeguard declines a request.
const CLAUDE_EFFORT = /^claude-(fable|mythos|opus|sonnet|haiku-5)/;
const CLAUDE_FALLBACK = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

/* ---------- what this browser keeps ---------- */
function load() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(LOCAL) ?? '{}'); } catch { /* nothing kept */ }
  // Before 0.5.0 there was one provider with one model and effort for everything: its key carries over, and each task
  // starts from its own recommendation.
  if (raw.key && !raw.keys) raw = { keys: { [raw.provider || 'anthropic']: raw.key } };
  return { keys: {}, models: {}, use: {}, puter: false, bridge: null, ...raw };
}
function keep(state) { try { localStorage.setItem(LOCAL, JSON.stringify(state)); } catch { /* not kept */ } }
function patch(fn) { const s = load(); fn(s); keep(s); return s; }
export function offered(way) {
  const w = WAYS[way];
  if (!w) return false;
  const s = settings.get();
  if (w.offer === 'provider') return s.providers.includes(way);
  return s.flags?.[w.offer] !== false;
}

export const keyOf = (way) => String(load().keys[way] ?? '');
export function setKey(way, key) {
  patch((s) => {
    s.keys[way] = String(key ?? '').trim();
    if (!s.keys[way]) { delete s.keys[way]; delete s.models[way]; }
  });
}
export function forget(way) {
  if (!way) { try { localStorage.removeItem(LOCAL); } catch { /* nothing to forget */ } return; }
  if (way === 'puter') { patch((s) => { s.puter = false; delete s.models.puter; }); window.puter?.auth?.signOut?.(); return; }
  if (way === 'bridge') { patch((s) => { s.bridge = null; for (const k of Object.keys(s.models)) if (k.startsWith('bridge:')) delete s.models[k]; }); return; }
  setKey(way, '');
}
const engineOf = (way) => load().bridge?.engines?.find((e) => e.id === WAYS[way]?.engine);
// The ways this person can use right now (and the admins offer).
export function connected() {
  const s = load();
  return Object.keys(WAYS).filter((way) => {
    if (!offered(way)) return false;
    if (way === 'puter') return !!s.puter;
    if (way.startsWith('bridge:')) return !!s.bridge?.token && !!engineOf(way)?.ready;
    return !!s.keys[way];
  });
}
export const ready = () => connected().length > 0;
export const cachedModels = (way) => load().models[way] ?? [];
export const wayName = (way) => (WAYS[way] ? `${WAYS[way].name} · ${WAYS[way].where}` : 'tu IA');
// What a way reads as it is: PDFs and pictures. The bridge says it for each of its engines.
export function readsOf(way) { return WAYS[way]?.reads ?? engineOf(way)?.reads ?? { pdf: false, images: true }; }
// Who made a model reached through a way: a guide records Claude, ChatGPT, Gemini or another AI.
export function vendorOf(way, model = '') {
  if (WAYS[way]?.vendor) return WAYS[way].vendor;
  const m = String(model).toLowerCase();
  if (/claude|anthropic/.test(m)) return 'anthropic';
  if (/gpt|openai|(^|\/)o\d/.test(m)) return 'openai';
  if (/gemini|google/.test(m)) return 'gemini';
  return 'other';
}

/* ---------- which model, and where ---------- */
const light = (id) => /(mini|nano|flash|lite|haiku|small|\(low\))/i.test(id);
const strong = (id) => /(opus|ultra|-max|\bpro\b|-pro)/i.test(id) || (!light(id) && /gpt-[5-9]|gpt-\d\d|gemini-[3-9]/i.test(id));
const tierOf = (id) => (light(id) ? 'light' : strong(id) ? 'strong' : 'mid');
// The model a task recommends for a way: Claude's by name; the bridge's by what each engine says; the others from the
// models the account lists.
export function recommend(task, way) {
  const tier = TASKS[task]?.tier ?? 'strong';
  if (way?.startsWith('bridge:')) {
    const models = engineOf(way)?.models ?? [];
    const pick = models.find((m) => m.tier === tier) ?? models.find((m) => m.tier === 'mid') ?? models[0];
    return pick?.id ?? '';
  }
  const named = PROVIDERS[way]?.tiers[tier];
  const list = cachedModels(way);
  if (named && (!list.length || list.includes(named))) return named;
  if (!list.length) return named ?? '';
  const pickFrom = (ids) => ids.find((id) => !/(preview|exp|latest|audio|tts|image|vision)/i.test(id)) ?? ids[0];
  if (way === 'puter') {
    const claude = list.filter((id) => /claude/i.test(id));
    const byTier = (ids) => ids.filter((id) => tierOf(id) === tier);
    return pickFrom(byTier(claude)) ?? pickFrom(byTier(list)) ?? pickFrom(claude) ?? list[0];
  }
  if (tier === 'light') return pickFrom(list.filter(light)) ?? list[0];
  if (tier === 'strong') return pickFrom(list.filter(strong)) ?? pickFrom(list.filter((id) => !light(id))) ?? list[0];
  return pickFrom(list.filter((id) => !light(id) && !strong(id))) ?? pickFrom(list.filter((id) => !light(id))) ?? list[0];
}
const effortsOf = (way) => (way.startsWith('bridge:') ? engineOf(way)?.efforts ?? [] : Object.keys(EFFORTS));
const fitEffort = (way, effort) => { const list = effortsOf(way); return !list.length ? '' : list.includes(effort) ? effort : list.includes('medium') ? 'medium' : list[0]; };
// The page's proposal for a task: the first way in its order that this person has, with its model and effort, and why.
export function suggest(task) {
  const tier = TASKS[task]?.tier ?? 'strong';
  const have = connected();
  const way = ORDER[tier].find((w) => have.includes(w));
  if (!way) return null;
  const model = recommend(task, way);
  const effort = fitEffort(way, TASKS[task]?.effort ?? 'high');
  return { provider: way, model, effort, why: WHY[way] };
}
// The choice for a task: the last one the person made, or the page's proposal.
export function choice(task) {
  const saved = load().use[task];
  if (saved && connected().includes(saved.provider)) {
    return { provider: saved.provider, model: saved.model || recommend(task, saved.provider), effort: fitEffort(saved.provider, saved.effort in EFFORTS ? saved.effort : TASKS[task].effort) };
  }
  const s = suggest(task);
  return s ? { provider: s.provider, model: s.model, effort: s.effort } : { provider: 'anthropic', model: recommend(task, 'anthropic'), effort: TASKS[task]?.effort ?? 'high' };
}
export function setChoice(task, c) {
  patch((s) => { s.use[task] = { provider: c.provider, model: String(c.model ?? '').trim(), effort: c.effort }; });
}
export function label(c) {
  const effort = (EFFORTS[c.effort] ?? '').toLowerCase();
  return [WAYS[c.provider]?.name ?? c.provider, c.model || '—', effort].filter(Boolean).join(' · ');
}

/* ---------- choosing at the moment of use ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const proposal = (task) => {
  const s = suggest(task);
  if (!s) return '';
  const effort = s.effort ? `, esfuerzo ${(EFFORTS[s.effort] ?? s.effort).toLowerCase()}` : '';
  return `Te recomiendo ${esc(s.model || 'el modelo de tu cuenta')} en ${esc(WAYS[s.provider].name)} (${esc(WAYS[s.provider].where)})${esc(effort)}, porque ${esc(s.why)}.`;
};
// A compact row: where, model and effort for this task, with what the page proposes.
export function pickerHTML(task) {
  const c = choice(task);
  const ways = connected();
  if (!ways.length) return '';
  const rec = recommend(task, c.provider);
  const list = [...new Set([rec, c.model, ...(c.provider.startsWith('bridge:') ? (engineOf(c.provider)?.models ?? []).map((m) => m.id) : cachedModels(c.provider))].filter(Boolean))];
  const efforts = effortsOf(c.provider);
  const s = suggest(task);
  const differs = s && (s.provider !== c.provider || (s.model && s.model !== c.model));
  return `<div class="ai-pick" data-ai-pick="${esc(task)}">
    <label class="field"><span>Dónde</span><select name="provider">${ways.map((w) => `<option value="${esc(w)}" ${w === c.provider ? 'selected' : ''}>${esc(wayName(w))}</option>`).join('')}</select></label>
    <label class="field model"><span>Modelo</span><input name="model" list="ai-models-${esc(task)}" value="${esc(c.model)}" autocomplete="off" spellcheck="false"><datalist id="ai-models-${esc(task)}">${list.map((m) => `<option value="${esc(m)}">`).join('')}</datalist></label>
    <label class="field" ${efforts.length ? '' : 'hidden'}><span>Esfuerzo</span><select name="effort">${(efforts.length ? efforts : ['medium']).map((k) => `<option value="${esc(k)}" ${k === c.effort ? 'selected' : ''}>${esc(EFFORTS[k] ?? k)}</option>`).join('')}</select></label>
    <p class="fine">${proposal(task)} ${differs ? `<button type="button" class="link" data-ai-suggest="${esc(task)}">Usar lo recomendado</button>` : ''}</p>
  </div>`;
}
// What the picker of a task says right now (and remember it).
export function picked(task, root = document) {
  const el = root.querySelector(`[data-ai-pick="${task}"]`);
  if (!el) return choice(task);
  const provider = el.querySelector('[name="provider"]').value;
  const c = { provider, model: el.querySelector('[name="model"]').value.trim(), effort: fitEffort(provider, el.querySelector('[name="effort"]').value) };
  if (!c.model) c.model = recommend(task, c.provider);
  setChoice(task, c);
  return c;
}
// Changing where a picker runs suggests that way's recommended model; «Usar lo recomendado» takes the proposal.
document.addEventListener('change', (e) => {
  const box = e.target.closest?.('[data-ai-pick]');
  if (!box) return;
  const task = box.dataset.aiPick;
  if (e.target.name === 'provider') {
    setChoice(task, { provider: e.target.value, model: recommend(task, e.target.value), effort: fitEffort(e.target.value, TASKS[task]?.effort ?? 'medium') });
    box.outerHTML = pickerHTML(task);
    return;
  }
  picked(task, box.parentElement ?? document);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-ai-suggest]');
  if (!b) return;
  const task = b.dataset.aiSuggest;
  const s = suggest(task);
  if (!s) return;
  setChoice(task, s);
  b.closest('[data-ai-pick]').outerHTML = pickerHTML(task);
});

/* ---------- the network ---------- */
async function http(way, url, init) {
  let res;
  try { res = await fetch(url, init); } catch (e) {
    if (init?.signal?.aborted) throw new AIError('Cancelado.', { kind: 'cancel', way });
    throw classify({ way, status: 0, message: e.message });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw classify({ way, status: res.status, message: body.error?.message ?? body.error ?? res.statusText, body, headers: res.headers });
  return body;
}

let sdk = null;
async function claude(key) {
  sdk ??= import(ANTHROPIC_SDK).then((m) => m.default);
  const Anthropic = await sdk;
  // The key is the person's own and stays in their browser, so the browser calls Anthropic directly.
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
}

/* ---------- Puter ---------- */
// Puter's script runs in this page only for those who connect Puter, and only from then on.
let puterReady = null;
function puterSDK() {
  if (window.puter) return Promise.resolve(window.puter);
  puterReady ??= new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: PUTER_SDK, async: true });
    s.onload = () => (window.puter ? resolve(window.puter) : reject(new Error('Puter no cargó')));
    s.onerror = () => { puterReady = null; reject(new AIError('No se pudo cargar Puter. Revisa tu internet.', { kind: 'transient', way: 'puter' })); };
    document.head.append(s);
  });
  return puterReady;
}
// From a click: Puter opens its own sign-in window.
export async function connectPuter() {
  const puter = await puterSDK();
  if (!puter.auth.isSignedIn()) {
    try { await puter.auth.signIn(); } catch (e) {
      throw new AIError(e?.error === 'popup_blocked' ? 'Tu navegador bloqueó la ventana de Puter. Permite ventanas emergentes y vuelve a pulsar «Conectar».' : 'No se completó el inicio de sesión en Puter.', { kind: 'account', way: 'puter' });
    }
  }
  patch((s) => { s.puter = true; });
  return models('puter').catch(() => []);
}
const puterError = (e) => {
  const code = e?.code ?? e?.error?.code ?? '';
  const status = e?.status ?? (code === 'insufficient_funds' ? 402 : code === 'too_many_requests' ? 429 : code === 'request_timeout' ? 504 : /network/.test(code) ? 0 : 500);
  return classify({ way: 'puter', status, message: e?.message ?? e?.error?.message ?? String(e), body: e });
};

/* ---------- OpenRouter ---------- */
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// From a click: to OpenRouter's sign-in, which comes back here with a code that this browser trades for a key.
export async function connectOpenRouter() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  sessionStorage.setItem('studium-openrouter', JSON.stringify({ verifier, back: location.hash || '#/ajustes' }));
  const back = location.origin + location.pathname;
  location.href = `${OPENROUTER}/auth?${new URLSearchParams({ callback_url: back, code_challenge: challenge, code_challenge_method: 'S256', key_label: 'Studium' })}`;
}
// On the page's start: when OpenRouter came back with a code, trade it for the key. Returns a message, or ''.
export async function finishOpenRouter() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code');
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem('studium-openrouter') ?? 'null'); } catch { /* nothing pending */ }
  if (!code || !pending?.verifier) return '';
  sessionStorage.removeItem('studium-openrouter');
  history.replaceState(null, '', location.pathname + (pending.back || '#/ajustes'));
  try {
    const body = await http('openrouter', `${OPENROUTER}/api/v1/auth/keys`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: pending.verifier, code_challenge_method: 'S256' }),
    });
    if (!body.key) throw new Error('sin clave');
    setKey('openrouter', body.key);
    await models('openrouter').catch(() => []);
    return 'OpenRouter quedó conectado.';
  } catch (e) { return e instanceof AIError ? e.message : 'OpenRouter no entregó la conexión. Vuelve a intentarlo.'; }
}

/* ---------- the bridge ---------- */
export const bridgeOf = () => load().bridge;
async function bridgeFetch(path, init = {}, b = bridgeOf()) {
  if (!b?.token) throw new AIError('Enlaza el puente en Ajustes.', { kind: 'account', way: 'bridge:claude' });
  return http(`bridge:${init.engine ?? 'claude'}`, `http://127.0.0.1:${b.port}${path}`, {
    ...init, headers: { authorization: `Bearer ${b.token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
}
// Is a bridge running on this computer? Asks without the code, so it never needs it.
export async function findBridge(port = BRIDGE_PORT) {
  try { const r = await fetch(`http://127.0.0.1:${port}/v1/hello`); return r.ok ? await r.json() : null; } catch { return null; }
}
// The link the bridge prints: «#/ajustes?puente=<port>.<code>».
export async function pairBridge(port, token) {
  const b = { port: Number(port) || BRIDGE_PORT, token: String(token), engines: [], at: 0 };
  patch((s) => { s.bridge = b; });
  return bridgeStatus();
}
// What the bridge has: its engines, whether each is signed in, their models, efforts and what they read.
export async function bridgeStatus() {
  const body = await bridgeFetch('/v1/status');
  const engines = Array.isArray(body.engines) ? body.engines : [];
  patch((s) => {
    if (!s.bridge) return;
    s.bridge.engines = engines; s.bridge.at = Date.now();
    for (const e of engines) s.models[`bridge:${e.id}`] = (e.models ?? []).map((m) => m.id);
  });
  return engines;
}

/* ---------- models an account can use ---------- */
// Lists them from the provider, and keeps the list in this browser for the pickers.
export async function models(way, key = keyOf(way)) {
  let ids = [];
  if (way.startsWith('bridge:')) return (await bridgeStatus()).find((e) => e.id === WAYS[way].engine)?.models?.map((m) => m.id) ?? [];
  if (way === 'puter') {
    const puter = await puterSDK();
    const list = await puter.ai.listModels().catch((e) => { throw puterError(e); });
    ids = list.map((m) => m.id).filter((id) => !/(image|tts|speech|whisper|embed|dall|video|audio)/i.test(id));
  } else if (way === 'openrouter') {
    const body = await http(way, `${OPENROUTER}/api/v1/models`, {});
    const free = (body.data ?? []).filter((m) => m.id.endsWith(':free') || (m.pricing?.prompt === '0' && m.pricing?.completion === '0'));
    // The ones that read pictures first: scans and photos of exams need them.
    const sees = (m) => (m.architecture?.input_modalities ?? []).includes('image');
    ids = [...free.filter(sees), ...free.filter((m) => !sees(m))].map((m) => m.id);
  } else {
    if (!key) throw new AIError('Pega tu clave primero.', { kind: 'account', way });
    if (way === 'anthropic') {
      const client = await claude(key);
      try { for await (const m of client.models.list()) ids.push(m.id); } catch (e) { throw classify({ way, status: e.status ?? 0, message: e.message, body: e.error }); }
    } else if (way === 'openai') {
      const body = await http(way, 'https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key}` } });
      ids = (body.data ?? []).map((m) => m.id).filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|search|embedding)/.test(id)).sort().reverse();
    } else {
      const body = await http(way, `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, {});
      ids = (body.models ?? []).filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent')).map((m) => m.name.replace(/^models\//, '')).filter((id) => /^gemini/.test(id)).sort().reverse();
    }
  }
  patch((s) => { s.models[way] = ids.slice(0, 120); });
  return ids;
}

/* ---------- files, read in the browser ---------- */
const TEXT = /\.(txt|md|markdown|csv|tsv|json|tex|py|c|cc|cpp|h|hpp|java|js|ts|html?|css|sql|r|m|ipynb)$/i;
export const MAX_FILE = 25_000_000;
export async function readFile(file) {
  if (file.size > MAX_FILE) return { name: file.name, skipped: 'pesa más de 25 MB' };
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return { name: file.name, type: 'application/pdf', data: await base64(file), size: file.size };
  if (/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) return { name: file.name, type: file.type, data: await base64(file), size: file.size };
  if (TEXT.test(file.name) || file.type.startsWith('text/')) return { name: file.name, type: 'text/plain', text: (await file.text()).slice(0, 400_000), size: file.size };
  return { name: file.name, skipped: 'tu IA no lee ese formato desde Studium: expórtalo como PDF' };
}
function base64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
// The parts as the way reads them: a PDF becomes pictures of its pages where the way does not read PDFs.
async function adapt(files, reads) {
  if (reads.pdf || !files.some((f) => f.type === 'application/pdf')) return files;
  const { pdfPictures } = await import('./files.js');
  const out = [];
  for (const f of files) out.push(...(f.type === 'application/pdf' ? await pdfPictures(f) : [f]));
  return out;
}
const dataURL = (f) => `data:${f.type};base64,${f.data}`;
// OpenAI's form of the parts, which OpenRouter and Puter also read.
const openaiParts = (files, text) => [
  ...files.flatMap((f) => (f.type === 'application/pdf'
    ? [{ type: 'file', file: { filename: f.name, file_data: dataURL(f) } }]
    : f.type?.startsWith('image/')
      ? [{ type: 'text', text: `--- ${f.name} ---` }, { type: 'image_url', image_url: { url: dataURL(f) } }]
      : [{ type: 'text', text: `--- ${f.name} ---\n${f.text}` }])),
  { type: 'text', text },
];

/* ---------- one request ---------- */
// system: the instructions; text: the request; files: what readFile returned; task: what it is for (its remembered
// choice applies), or use: the way, model and effort picked for it. Returns the text the model wrote, which model
// wrote it and who makes it (provider), and where it ran (way), so that a guide can say what made it.
export const longest = (c) => (c.provider === 'anthropic' || c.provider === 'bridge:claude' ? 64000 : 32000);
export async function run({ system, text, files = [], maxTokens = 32000, onProgress, signal, task = 'guide', use = null } = {}) {
  const c = { ...(use ?? choice(task)) };
  const way = c.provider;
  if (!WAYS[way] || !connected().includes(way)) throw new AIError('Conecta tu IA en Ajustes.', { kind: 'account', way });
  const model = c.model || recommend(task, way);
  if (!model) throw new AIError('Elige un modelo: pulsa «Probar» en Ajustes para ver los de tu cuenta.', { kind: 'account', way });
  const effort = fitEffort(way, c.effort);
  const usable = await adapt(files.filter((f) => !f.skipped), readsOf(way));
  const meta = { provider: vendorOf(way, model), way, model, effort };
  try {
    const out = await send({ way, model, effort, system, text, files: usable, maxTokens, onProgress, signal });
    return { ...out, ...meta, truncated: !!out.truncated };
  } catch (e) {
    if (e instanceof AIError) throw e;
    if (signal?.aborted) throw new AIError('Cancelado.', { kind: 'cancel', way });
    throw classify({ way, status: e.status ?? 0, message: e.message, body: e.error ?? e.body, headers: e.headers });
  }
}

async function send({ way, model, effort, system, text, files, maxTokens, onProgress, signal }) {
  if (way === 'anthropic') {
    const client = await claude(keyOf(way));
    // Pictures carry their name in a line before them, so the AI knows their order («hoja 1», «hoja 2»).
    const content = [
      ...files.flatMap((f) => (f.type === 'application/pdf'
        ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data }, title: f.name }]
        : f.type.startsWith('image/')
          ? [{ type: 'text', text: `--- ${f.name} ---` }, { type: 'image', source: { type: 'base64', media_type: f.type, data: f.data } }]
          : [{ type: 'text', text: `--- ${f.name} ---\n${f.text}` }])),
      { type: 'text', text },
    ];
    const params = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }], ...(CLAUDE_EFFORT.test(model) ? { output_config: { effort } } : {}) };
    // Long answers stream, so that they never hit a request timeout. When a safeguard declines a request on the
    // newest models, the API retries it on a fallback model by itself.
    const stream = CLAUDE_FALLBACK.has(model)
      ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
      : client.messages.stream(params, { signal });
    let written = 0;
    stream.on('text', (delta) => { written += delta.length; onProgress?.(written); });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new AIError('Tu IA se negó a procesar este material. Revisa que sea material de estudio.', { kind: 'job', way });
    return { text: message.content.filter((b) => b.type === 'text').map((b) => b.text).join(''), truncated: message.stop_reason === 'max_tokens' };
  }

  if (way === 'openai' || way === 'openrouter') {
    const reasoning = /^(o\d|gpt-5|gpt-6)/.test(model) || way === 'openrouter';
    const level = effort === 'xhigh' ? 'high' : effort;
    onProgress?.(-1);
    const body = await http(way, way === 'openai' ? 'https://api.openai.com/v1/chat/completions' : `${OPENROUTER}/api/v1/chat/completions`, {
      method: 'POST', signal,
      headers: { authorization: `Bearer ${keyOf(way)}`, 'content-type': 'application/json', ...(way === 'openrouter' ? { 'x-title': 'Studium', 'http-referer': location.origin + location.pathname } : {}) },
      body: JSON.stringify({
        model, messages: [{ role: 'system', content: system }, { role: 'user', content: openaiParts(files, text) }],
        ...(way === 'openai' ? { max_completion_tokens: maxTokens, ...(reasoning && level ? { reasoning_effort: level } : {}) } : { max_tokens: maxTokens, ...(level ? { reasoning: { effort: level } } : {}) }),
      }),
    });
    const choice = body.choices?.[0];
    if (body.error) throw classify({ way, status: Number(body.error.code) || 500, message: body.error.message, body });
    return { text: choice?.message?.content ?? '', truncated: choice?.finish_reason === 'length' };
  }

  if (way === 'gemini') {
    const parts = [
      ...files.flatMap((f) => (f.data ? [{ text: `--- ${f.name} ---` }, { inline_data: { mime_type: f.type, data: f.data } }] : [{ text: `--- ${f.name} ---\n${f.text}` }])),
      { text },
    ];
    onProgress?.(-1);
    const body = await http(way, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(keyOf(way))}`, {
      method: 'POST', signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: maxTokens } }),
    });
    const cand = body.candidates?.[0];
    if (cand?.finishReason === 'SAFETY') throw new AIError('Tu IA se negó a procesar este material.', { kind: 'job', way });
    return { text: (cand?.content?.parts ?? []).map((p) => p.text ?? '').join(''), truncated: cand?.finishReason === 'MAX_TOKENS' };
  }

  if (way === 'puter') {
    const puter = await puterSDK();
    if (!puter.auth.isSignedIn()) { patch((s) => { s.puter = false; }); throw new AIError('Tu sesión de Puter terminó. Vuelve a conectarla en Ajustes.', { kind: 'account', way }); }
    onProgress?.(-1);
    // Files go to a folder of the person's own Puter space for this one request, and are deleted afterwards. If that
    // fails, pictures go inline and PDFs as pictures of their pages.
    const folder = `Studium-temporal-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    let content;
    let stored = false;
    try {
      content = [];
      for (const f of files) {
        if (!f.data) { content.push({ type: 'text', text: `--- ${f.name} ---\n${f.text}` }); continue; }
        const blob = new Blob([Uint8Array.from(atob(f.data), (ch) => ch.charCodeAt(0))], { type: f.type });
        const item = await puter.fs.write(`${folder}/${f.name.replace(/[\\/:*?"<>|]+/g, '-')}`, blob, { createMissingParents: true });
        stored = true;
        content.push({ type: 'text', text: `--- ${f.name} ---` }, { type: 'file', puter_path: item.path });
      }
      content.push({ type: 'text', text });
    } catch {
      content = openaiParts(await adapt(files, { pdf: false, images: true }), text).filter((p) => p.type !== 'file');
    }
    try {
      const r = await puter.ai.chat([{ role: 'system', content: system }, { role: 'user', content }], false, { model, max_tokens: maxTokens, normalize: true, signal, ...(effort ? { reasoning_effort: effort === 'xhigh' ? 'high' : effort } : {}) });
      const out = typeof r?.message?.content === 'string' ? r.message.content : (r?.message?.content ?? []).map((b) => b.text ?? '').join('') || String(r ?? '');
      return { text: out, truncated: r?.finish_reason === 'length' };
    } catch (e) { throw e instanceof AIError ? e : puterError(e); } finally {
      if (stored) puter.fs.delete(folder, { recursive: true }).catch(() => {});
    }
  }

  // The bridge: the person's own CLI, on their computer.
  onProgress?.(-1);
  const engine = WAYS[way].engine;
  const body = await bridgeFetch('/v1/run', {
    method: 'POST', signal, engine,
    body: JSON.stringify({ engine, model, effort, system, text, files: files.map((f) => (f.data ? { name: f.name, type: f.type, data: f.data } : { name: f.name, type: 'text/plain', text: f.text })) }),
  });
  return { text: String(body.text ?? '') };
}

// The HTML page inside an answer: tolerant of code fences and text around it.
export function htmlFrom(text) {
  const t = String(text ?? '');
  const fenced = t.match(/```(?:html)?\s*(<!doctype html[\s\S]*?)```/i)?.[1];
  if (fenced) return fenced.trim();
  const start = t.search(/<!doctype html/i);
  if (start < 0) return '';
  const end = t.toLowerCase().lastIndexOf('</html>');
  return t.slice(start, end > start ? end + 7 : undefined).trim();
}
