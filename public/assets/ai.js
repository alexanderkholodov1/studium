// Bring your own AI: Claude, ChatGPT and Gemini, all at once if the person wants, each called from this page with the
// person's own API key. Keys stay in this browser (localStorage); they never reach Studium's database. Studium charges
// nothing: each provider bills its own usage to the key's owner.
// Which provider, model and effort is chosen when the AI is used, for that task: creating a guide deserves the
// strongest model, identifying a document a light one. The last choice per task is remembered.
import { settings } from './settings.js';

const LOCAL = 'studium-ai';
const ANTHROPIC_SDK = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.5.0/+esm';

export const PROVIDERS = {
  anthropic: { name: 'Claude', by: 'Anthropic', keyHint: 'sk-ant-…', keys: 'https://console.anthropic.com/settings/keys',
    tiers: { strong: 'claude-opus-5-5', mid: 'claude-sonnet-5-5', light: 'claude-haiku-5-5' } },
  openai: { name: 'ChatGPT', by: 'OpenAI', keyHint: 'sk-…', keys: 'https://platform.openai.com/api-keys', tiers: {} },
  gemini: { name: 'Gemini', by: 'Google', keyHint: 'AIza…', keys: 'https://aistudio.google.com/apikey', tiers: {} },
};
export const EFFORTS = { low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto' };
// What each use of the AI needs, and what it recommends.
export const TASKS = {
  guide: { name: 'Crear una guía', tier: 'strong', effort: 'high', why: 'una guía completa merece el modelo más potente' },
  edit: { name: 'Editar una guía', tier: 'strong', effort: 'medium', why: 'cambiar una sección pide buen criterio, sin rehacer todo' },
  material: { name: 'Procesar material', tier: 'mid', effort: 'medium', why: 'leer apuntes y exámenes es trabajo de un modelo intermedio' },
  identify: { name: 'Identificar un documento', tier: 'light', effort: 'low', why: 'reconocer un sílabo o un enunciado basta con un modelo ligero' },
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
  return { keys: {}, models: {}, use: {}, ...raw };
}
function keep(state) { try { localStorage.setItem(LOCAL, JSON.stringify(state)); } catch { /* not kept */ } }
const allowed = (p) => settings.get().providers.includes(p);

export const keyOf = (provider) => String(load().keys[provider] ?? '');
export function setKey(provider, key) {
  const s = load();
  s.keys[provider] = String(key ?? '').trim();
  if (!s.keys[provider]) { delete s.keys[provider]; delete s.models[provider]; }
  keep(s);
}
export function forget(provider) {
  if (!provider) { try { localStorage.removeItem(LOCAL); } catch { /* nothing to forget */ } return; }
  setKey(provider, '');
}
// The providers this person connected (and the admins offer).
export const connected = () => Object.keys(PROVIDERS).filter((p) => keyOf(p) && allowed(p));
export const ready = () => connected().length > 0;
export const cachedModels = (provider) => load().models[provider] ?? [];

// The model a task recommends for a provider: Claude's by name; for the others, from the models the key lists.
export function recommend(task, provider) {
  const tier = TASKS[task]?.tier ?? 'strong';
  const named = PROVIDERS[provider]?.tiers[tier];
  const list = cachedModels(provider);
  if (named && (!list.length || list.includes(named))) return named;
  if (!list.length) return named ?? '';
  const light = (id) => /(mini|nano|flash|lite|haiku|small)/.test(id);
  const strong = (id) => /(pro|opus|ultra|-max)/.test(id) || (!light(id) && /gpt-5|gpt-4\.1|gemini-[3-9]/.test(id));
  const pickFrom = (ids) => ids.find((id) => !/(preview|exp|latest|audio|tts|image|vision)/.test(id)) ?? ids[0];
  if (tier === 'light') return pickFrom(list.filter(light)) ?? list[0];
  if (tier === 'strong') return pickFrom(list.filter(strong)) ?? pickFrom(list.filter((id) => !light(id))) ?? list[0];
  return pickFrom(list.filter((id) => !light(id) && !strong(id))) ?? pickFrom(list.filter((id) => !light(id))) ?? list[0];
}
// The choice for a task: the last one the person made, or the recommendation with the first connected provider.
export function choice(task) {
  const saved = load().use[task];
  const providers = connected();
  if (saved && providers.includes(saved.provider)) return { provider: saved.provider, model: saved.model || recommend(task, saved.provider), effort: saved.effort in EFFORTS ? saved.effort : TASKS[task].effort };
  const provider = providers[0] ?? 'anthropic';
  return { provider, model: recommend(task, provider), effort: TASKS[task]?.effort ?? 'high' };
}
export function setChoice(task, c) {
  const s = load();
  s.use[task] = { provider: c.provider, model: String(c.model ?? '').trim(), effort: c.effort };
  keep(s);
}
export function label(c) {
  const p = PROVIDERS[c.provider];
  return `${p?.name ?? c.provider} · ${c.model || '—'} · ${(EFFORTS[c.effort] ?? '').toLowerCase()}`;
}

/* ---------- choosing at the moment of use ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
// A compact row: provider, model and effort for this task, with what it recommends.
export function pickerHTML(task) {
  const c = choice(task);
  const providers = connected();
  if (!providers.length) return '';
  const rec = recommend(task, c.provider);
  const list = [...new Set([rec, c.model, ...cachedModels(c.provider)].filter(Boolean))];
  return `<div class="ai-pick" data-ai-pick="${esc(task)}">
    <label class="field"><span>IA</span><select name="provider">${providers.map((p) => `<option value="${p}" ${p === c.provider ? 'selected' : ''}>${esc(PROVIDERS[p].name)}</option>`).join('')}</select></label>
    <label class="field model"><span>Modelo</span><input name="model" list="ai-models-${esc(task)}" value="${esc(c.model)}" autocomplete="off" spellcheck="false"><datalist id="ai-models-${esc(task)}">${list.map((m) => `<option value="${esc(m)}">`).join('')}</datalist></label>
    <label class="field"><span>Esfuerzo</span><select name="effort">${Object.entries(EFFORTS).map(([k, v]) => `<option value="${k}" ${k === c.effort ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
    <p class="fine">Recomendado para ${esc(TASKS[task].name.toLowerCase())}: ${esc(rec || 'el más potente de tu cuenta')}, esfuerzo ${esc(EFFORTS[TASKS[task].effort].toLowerCase())}: ${esc(TASKS[task].why)}.</p>
  </div>`;
}
// What the picker of a task says right now (and remember it).
export function picked(task, root = document) {
  const el = root.querySelector(`[data-ai-pick="${task}"]`);
  if (!el) return choice(task);
  const c = { provider: el.querySelector('[name="provider"]').value, model: el.querySelector('[name="model"]').value.trim(), effort: el.querySelector('[name="effort"]').value };
  if (!c.model) c.model = recommend(task, c.provider);
  setChoice(task, c);
  return c;
}
// Changing the provider of a picker suggests that provider's recommended model.
document.addEventListener('change', (e) => {
  const box = e.target.closest?.('[data-ai-pick]');
  if (!box) return;
  const task = box.dataset.aiPick;
  if (e.target.name === 'provider') {
    const provider = e.target.value;
    const rec = recommend(task, provider);
    box.querySelector('[name="model"]').value = rec;
    box.querySelector('datalist').innerHTML = [...new Set([rec, ...cachedModels(provider)].filter(Boolean))].map((m) => `<option value="${esc(m)}">`).join('');
  }
  picked(task, box.parentElement ?? document);
});

/* ---------- errors, in words a student understands ---------- */
export class AIError extends Error {}
function explain(status, message = '') {
  if (status === 401 || status === 403) return new AIError('Tu proveedor rechazó la clave. Revisa que esté completa y activa.');
  if (status === 429) return new AIError('Tu proveedor dice que llegaste a un límite de uso o que tu cuenta no tiene saldo.');
  if (status === 404) return new AIError('Ese modelo no existe en tu cuenta. Elige otro.');
  if (status === 413) return new AIError('El archivo es demasiado grande para tu proveedor. Prueba con menos páginas.');
  if (status >= 500) return new AIError('Tu proveedor está con problemas en este momento. Vuelve a probar en un rato.');
  if (status === 0) return new AIError('No hubo conexión con tu proveedor. Revisa tu internet.');
  return new AIError(`Tu proveedor respondió: ${String(message).slice(0, 220)}`);
}
async function http(url, init) {
  let res;
  try { res = await fetch(url, init); } catch { throw explain(0); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw explain(res.status, body.error?.message ?? body.error ?? res.statusText);
  return body;
}

let sdk = null;
async function claude(key) {
  sdk ??= import(ANTHROPIC_SDK).then((m) => m.default);
  const Anthropic = await sdk;
  // The key is the person's own and stays in their browser, so the browser calls Anthropic directly.
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
}

/* ---------- models a key can use ---------- */
// Lists them from the provider, and keeps the list in this browser for the pickers.
export async function models(provider, key = keyOf(provider)) {
  if (!key) throw new AIError('Pega tu clave primero.');
  let ids = [];
  if (provider === 'anthropic') {
    const client = await claude(key);
    try { for await (const m of client.models.list()) ids.push(m.id); } catch (e) { throw explain(e.status ?? 0, e.message); }
  } else if (provider === 'openai') {
    const body = await http('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key}` } });
    ids = (body.data ?? []).map((m) => m.id).filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|search|embedding)/.test(id)).sort().reverse();
  } else {
    const body = await http(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, {});
    ids = (body.models ?? []).filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent')).map((m) => m.name.replace(/^models\//, '')).filter((id) => /^gemini/.test(id)).sort().reverse();
  }
  const st = load();
  st.models[provider] = ids.slice(0, 80);
  keep(st);
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

/* ---------- one request ---------- */
// system: the instructions; text: the request; files: what readFile returned; task: what it is for (its remembered
// choice applies), or use: the provider, model and effort picked for it. Returns the text the model wrote and which
// model wrote it, so that a guide can say what made it.
export const longest = (c) => (c.provider === 'anthropic' ? 64000 : 32000);
export async function run({ system, text, files = [], maxTokens = 32000, onProgress, signal, task = 'guide', use = null } = {}) {
  const c = { ...(use ?? choice(task)) };
  c.key = keyOf(c.provider);
  if (!c.key) throw new AIError('Conecta tu IA en Ajustes: pega la clave de tu proveedor.');
  const model = c.model || recommend(task, c.provider);
  if (!model) throw new AIError('Elige un modelo: pulsa «Probar» en Ajustes para ver los de tu cuenta.');
  const usable = files.filter((f) => !f.skipped);
  const meta = { provider: c.provider, model, effort: c.effort };

  if (c.provider === 'anthropic') {
    const client = await claude(c.key);
    const content = [
      ...usable.map((f) => (f.type === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data }, title: f.name }
        : f.type.startsWith('image/')
          ? { type: 'image', source: { type: 'base64', media_type: f.type, data: f.data } }
          : { type: 'text', text: `--- ${f.name} ---\n${f.text}` })),
      { type: 'text', text },
    ];
    const params = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }], ...(CLAUDE_EFFORT.test(model) ? { output_config: { effort: c.effort } } : {}) };
    // Long answers stream, so that they never hit a request timeout. When a safeguard declines a request on the
    // newest models, the API retries it on a fallback model by itself.
    const stream = CLAUDE_FALLBACK.has(model)
      ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
      : client.messages.stream(params, { signal });
    let written = 0;
    stream.on('text', (delta) => { written += delta.length; onProgress?.(written); });
    let message;
    try { message = await stream.finalMessage(); } catch (e) { if (signal?.aborted) throw new AIError('Cancelado.'); throw explain(e.status ?? 0, e.message); }
    if (message.stop_reason === 'refusal') throw new AIError('Tu IA se negó a procesar este material. Revisa que sea material de estudio.');
    const out = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (message.stop_reason === 'max_tokens') meta.truncated = true;
    return { text: out, ...meta };
  }

  if (c.provider === 'openai') {
    const parts = [
      ...usable.map((f) => (f.type === 'application/pdf'
        ? { type: 'file', file: { filename: f.name, file_data: `data:application/pdf;base64,${f.data}` } }
        : f.type.startsWith('image/')
          ? { type: 'image_url', image_url: { url: `data:${f.type};base64,${f.data}` } }
          : { type: 'text', text: `--- ${f.name} ---\n${f.text}` })),
      { type: 'text', text },
    ];
    const reasoning = /^(o\d|gpt-5)/.test(model);
    onProgress?.(-1);
    const body = await http('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal,
      headers: { authorization: `Bearer ${c.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: parts }], max_completion_tokens: maxTokens, ...(reasoning ? { reasoning_effort: c.effort === 'xhigh' ? 'high' : c.effort } : {}) }),
    });
    const choice = body.choices?.[0];
    if (choice?.finish_reason === 'length') meta.truncated = true;
    return { text: choice?.message?.content ?? '', ...meta };
  }

  const parts = [
    ...usable.map((f) => (f.data ? { inline_data: { mime_type: f.type, data: f.data } } : { text: `--- ${f.name} ---\n${f.text}` })),
    { text },
  ];
  onProgress?.(-1);
  const body = await http(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(c.key)}`, {
    method: 'POST', signal, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: maxTokens } }),
  });
  const cand = body.candidates?.[0];
  if (cand?.finishReason === 'MAX_TOKENS') meta.truncated = true;
  if (cand?.finishReason === 'SAFETY') throw new AIError('Tu IA se negó a procesar este material.');
  return { text: (cand?.content?.parts ?? []).map((p) => p.text ?? '').join(''), ...meta };
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
