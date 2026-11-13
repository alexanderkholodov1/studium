// What a provider's error means for the person and for the queue, in words a student understands. Pure: no page, no
// network, so it is tested in Node (tools/test-queue.mjs).
//
// Every error has a kind, which the queue acts on:
// - account: something only the person can fix (a key without balance, a refused key, a bridge to open again, a model
//   the account does not have). The queue stops and says what to do.
// - daily: a daily allowance is used up. That way pauses until its reset (retryAt) and resumes alone.
// - rate: too many requests for now. Wait retryAt, then go on.
// - transient: the network or the provider failed. Retry a few times, waiting longer each time.
// - job: this part cannot be done (too large, refused); the rest goes on.
// - cancel: the person stopped it.
export class AIError extends Error {
  constructor(message, { kind = 'job', retryAt = 0, way = '' } = {}) {
    super(message);
    this.kind = kind;
    this.retryAt = retryAt;
    this.way = way;
  }
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;

// The next midnight in a time zone: Gemini's daily limits reset at midnight in California, OpenRouter's in UTC.
export function nextMidnight(timeZone = 'UTC', now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date(now)).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  // Midnight of the next day there, as if it were UTC, then corrected by that zone's offset at that moment.
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day + 1);
  const offset = (at) => {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(new Date(at)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) * MINUTE : 0;
  };
  return guess - offset(guess - offset(guess));
}

// "37s", "1.5s", "2m": a delay as the providers write it.
function delayOf(text) {
  const m = String(text ?? '').match(/(\d+(?:\.\d+)?)\s*(ms|s|m|h)\b/);
  if (!m) return 0;
  const n = Number(m[1]);
  return Math.round(n * { ms: 1, s: SECOND, m: MINUTE, h: 60 * MINUTE }[m[2]]);
}
const retryAfterOf = (headers) => {
  const v = typeof headers?.get === 'function' ? headers.get('retry-after') : headers?.['retry-after'];
  if (v == null || v === '') return 0;
  const n = Number(v);
  if (Number.isFinite(n)) return n * SECOND;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
};
const flat = (body) => { try { return typeof body === 'string' ? body : JSON.stringify(body ?? ''); } catch { return ''; } };

const NO_API = 'Una suscripción de claude.ai, gratis o Pro, no incluye la API. Puedes usar Claude Code con el puente, Gemini gratis, OpenRouter o Puter, o hacerlo por chat.';

// way: which connection failed ('anthropic', 'openai', 'gemini', 'openrouter', 'puter', 'bridge:<engine>').
// status: HTTP status (0 when there was no connection). message: the provider's own text. body: its error body.
export function classify({ way = '', status = 0, message = '', body = null, headers = null, now = Date.now() } = {}) {
  const text = `${message} ${flat(body)}`;
  const opts = (kind, retryAt = 0) => ({ kind, retryAt, way });
  const bridge = way.startsWith('bridge:');

  if (bridge) {
    const code = body?.error?.code ?? '';
    const said = body?.error?.message;
    if (status === 0) return new AIError('El puente no responde. Ábrelo otra vez en tu computadora (node studium-bridge.mjs) y pulsa «Seguir».', opts('account'));
    if (status === 401) return new AIError('El puente cambió su código de enlace. Vuelve a enlazarlo en Ajustes con el enlace que imprime.', opts('account'));
    if (status === 403) return new AIError('El puente no acepta pedidos de esta página. Ábrelo con la versión que descargaste de Studium.', opts('account'));
    if (status === 424) return new AIError(said || 'Esa IA no está lista en tu computadora: revisa que esté instalada y con tu sesión iniciada.', opts('account'));
    if (status === 429) {
      const at = Date.parse(body?.error?.resetsAt ?? '');
      return Number.isFinite(at) && at > now
        ? new AIError(said || 'Tu suscripción llegó a su límite de uso.', opts('daily', at))
        : new AIError(said || 'Tu suscripción llegó a su límite de uso por ahora.', opts('rate', now + 5 * MINUTE));
    }
    if (status === 413) return new AIError('Esta parte es demasiado grande para el puente.', opts('job'));
    if (status === 504 || status >= 500) return new AIError(said || 'Tu IA tardó demasiado o falló en tu computadora.', opts('transient'));
    return new AIError(said || `El puente respondió con un error (${status}).`, opts('job'));
  }

  if (status === 0) return new AIError('No hubo conexión con tu IA. Revisa tu internet.', opts('transient'));

  if (way === 'anthropic') {
    if (/credit balance is too low|purchase credits|billing/i.test(text)) return new AIError(`Tu cuenta de la API de Anthropic no tiene saldo. ${NO_API}`, opts('account'));
    if (status === 529 || /overloaded/i.test(text)) return new AIError('Claude está saturado en este momento. Studium vuelve a probar en un rato.', opts('transient'));
  }
  if (way === 'openai' && /insufficient_quota|exceeded your current quota|billing/i.test(text)) {
    return new AIError('Tu cuenta de la API de OpenAI no tiene saldo. Una suscripción de ChatGPT no incluye la API: puedes usar Codex con el puente, Gemini gratis, OpenRouter o Puter, o hacerlo por chat.', opts('account'));
  }
  if (way === 'puter' && (status === 402 || /insufficient_funds/i.test(text))) {
    return new AIError('Tu cuenta de Puter usó todo lo que tenía disponible. Elige otra IA para lo que falta.', opts('account'));
  }
  if (way === 'openrouter' && status === 402) {
    return new AIError('Ese modelo de OpenRouter cobra y tu cuenta no tiene saldo. Elige un modelo gratis.', opts('account'));
  }

  if (status === 401 || status === 403) return new AIError('Tu IA rechazó la conexión. Revisa la clave o vuelve a conectarla en Ajustes.', opts('account'));
  if (status === 404) return new AIError('Ese modelo no existe en tu cuenta. Elige otro.', opts('account'));
  if (status === 413) return new AIError('Esta parte es demasiado grande para tu IA. Prueba con menos páginas.', opts('job'));

  if (status === 429) {
    if (way === 'gemini' && /PerDay|per day|daily/i.test(text)) {
      return new AIError('Usaste los pedidos gratis de hoy en Gemini. Se renuevan a medianoche de California.', opts('daily', nextMidnight('America/Los_Angeles', now)));
    }
    if (way === 'openrouter' && /per[- ]day|free-models-per-day|daily/i.test(text)) {
      return new AIError('Usaste los pedidos gratis de hoy en OpenRouter. Se renuevan a medianoche UTC.', opts('daily', nextMidnight('UTC', now)));
    }
    const wait = retryAfterOf(headers) || delayOf(body?.error?.details?.find?.((d) => d.retryDelay)?.retryDelay) || delayOf(text.match(/retry in ([\d.]+\s*m?s)/i)?.[1]) || 30 * SECOND;
    return new AIError('Tu IA pidió una pausa: demasiados pedidos seguidos. Studium espera y sigue solo.', opts('rate', now + Math.min(wait, 30 * MINUTE)));
  }
  if (status >= 500) return new AIError('Tu IA está con problemas en este momento. Studium vuelve a probar en un rato.', opts('transient'));
  return new AIError(`Tu IA respondió: ${String(message || flat(body)).slice(0, 220)}`, opts('job'));
}
