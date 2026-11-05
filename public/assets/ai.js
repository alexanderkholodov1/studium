// Bring your own AI: Claude, ChatGPT or Gemini, called from this page with the person's own API key. The key stays in
// this browser (localStorage); it never reaches Studium's database. Studium charges nothing: each provider bills its
// own usage to the key's owner.

const LOCAL = 'studium-ai';
const ANTHROPIC_SDK = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.5.0/+esm';

export const PROVIDERS = {
  anthropic: { name: 'Claude', by: 'Anthropic', keyHint: 'sk-ant-…', keys: 'https://console.anthropic.com/settings/keys', model: 'claude-opus-5-5' },
  openai: { name: 'ChatGPT', by: 'OpenAI', keyHint: 'sk-…', keys: 'https://platform.openai.com/api-keys', model: '' },
  gemini: { name: 'Gemini', by: 'Google', keyHint: 'AIza…', keys: 'https://aistudio.google.com/apikey', model: '' },
};
export const EFFORTS = { low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto' };
// Claude models that accept the effort setting and the server-side fallback when a safeguard declines a request.
const CLAUDE_EFFORT = /^claude-(fable|mythos|opus|sonnet|haiku-5)/;
const CLAUDE_FALLBACK = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

export function config() {
  try { return { provider: 'anthropic', key: '', model: '', effort: 'high', ...JSON.parse(localStorage.getItem(LOCAL) ?? '{}') }; }
  catch { return { provider: 'anthropic', key: '', model: '', effort: 'high' }; }
}
export function save(cfg) {
  const clean = { provider: cfg.provider in PROVIDERS ? cfg.provider : 'anthropic', key: String(cfg.key ?? '').trim(), model: String(cfg.model ?? '').trim(), effort: cfg.effort in EFFORTS ? cfg.effort : 'high' };
  try { localStorage.setItem(LOCAL, JSON.stringify(clean)); } catch { /* not kept */ }
  return clean;
}
export function forget() { try { localStorage.removeItem(LOCAL); } catch { /* nothing to forget */ } }
export const ready = () => { const c = config(); return !!(c.key && (c.model || PROVIDERS[c.provider].model)); };
export function label(c = config()) {
  const p = PROVIDERS[c.provider];
  return `${p.name} · ${c.model || p.model} · ${(EFFORTS[c.effort] ?? '').toLowerCase()}`;
}

/* ---------- errors, in words a student understands ---------- */
export class AIError extends Error {}
function explain(status, message = '') {
  if (status === 401 || status === 403) return new AIError('Tu proveedor rechazó la clave. Revisa que esté completa y activa.');
  if (status === 429) return new AIError('Tu proveedor dice que llegaste a un límite de uso o que tu cuenta no tiene saldo.');
  if (status === 404) return new AIError('Ese modelo no existe en tu cuenta. Elige otro en Ajustes.');
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

/* ---------- models the key can use ---------- */
export async function models(c = config()) {
  if (!c.key) throw new AIError('Pega tu clave primero.');
  if (c.provider === 'anthropic') {
    const client = await claude(c.key);
    const ids = [];
    try { for await (const m of client.models.list()) ids.push(m.id); } catch (e) { throw explain(e.status ?? 0, e.message); }
    return ids;
  }
  if (c.provider === 'openai') {
    const body = await http('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${c.key}` } });
    return (body.data ?? []).map((m) => m.id).filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|search|embedding)/.test(id)).sort().reverse();
  }
  const body = await http(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(c.key)}`, {});
  return (body.models ?? []).filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent')).map((m) => m.name.replace(/^models\//, '')).filter((id) => /^gemini/.test(id)).sort().reverse();
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
// system: the instructions; text: the request; files: what readFile returned. Returns the text the model wrote and
// which model wrote it, so that a guide can say what made it.
export async function run({ system, text, files = [], maxTokens = 32000, onProgress, signal } = {}) {
  const c = config();
  if (!c.key) throw new AIError('Configura tu IA en Ajustes: elige el proveedor y pega tu clave.');
  const model = c.model || PROVIDERS[c.provider].model;
  if (!model) throw new AIError('Elige un modelo en Ajustes.');
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
