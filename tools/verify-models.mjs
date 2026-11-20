// Every Gemini model, verified at Google's own pricing page, without any AI and at no cost: the page's published plain
// text (pricing.md) is read section by section; each model gets its state (free tier or not), the exact lines that say
// so, its note (deprecations, redirects, dates) and the link to its section. `-latest` aliases are not on the pricing
// page and may point to another model at any time: the models page says so, and Studium does not use them.
// Usage: node tools/verify-models.mjs            writes public/data/models.json
//        node tools/verify-models.mjs --check    compares with public/data/models.json (exit 0; a warning if it changed)
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PRICING = 'https://aistudio.google.com/docs/pricing.md';
const MODELS = 'https://aistudio.google.com/docs/models.md';
const PAGE = 'https://aistudio.google.com/docs/pricing';
const OUT = new URL('../public/data/models.json', import.meta.url);

const get = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': 'Studium model check' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
};
const clean = (s) => s.replace(/\{%[^%]*%\}/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();

export function parsePricing(md) {
  const out = {};
  for (const part of md.split(/\n(?=## )/)) {
    const head = part.match(/^## (.*?)\s*\{% id="([^"]+)" %\}/);
    if (!head) continue;
    // The section's own models: the code links at its top (other codes in the text are mentions, e.g. redirects).
    const top = part.split('{% hr /%}')[0];
    const codes = [...new Set([...top.matchAll(/`((?:gemini|genie|gemma|lyria)[a-z0-9.-]*)`/g)].map((m) => m[1]))];
    if (!codes.length) continue;
    const row = part.match(/\* Input price[^\n]*\n\s*\* ([^\n]+)/);
    const cell = row ? row[1].trim() : '';
    const state = /free of charge/i.test(cell) ? 'free' : /not available/i.test(cell) ? 'paid' : 'unknown';
    const callout = part.match(/\{% callout[^%]*%\}([\s\S]*?)\{% \/callout %\}/);
    const note = callout ? clean(callout[1]).slice(0, 600) : '';
    // A model being retired is not recommended, free or not: its requests are redirected and billed at another's rates.
    const retiring = /deprecated|shut ?down|redirected/i.test(note);
    for (const code of codes) {
      out[code] = { state: retiring ? 'deprecated' : state, section: clean(head[1]), quote: row ? `Input price — Free Tier: ${cell}` : '', note, url: `${PAGE}#${head[2]}` };
    }
  }
  return out;
}

export function parseAliases(md) {
  const i = md.search(/### Latest/);
  if (i < 0) return null;
  const text = clean(md.slice(i, i + 900).split('\n### ')[0].replace(/^### Latest[^\n]*\n/, ''));
  return { quote: text.slice(0, 500), url: 'https://aistudio.google.com/docs/models#latest' };
}

async function build() {
  const [pricing, models] = await Promise.all([get(PRICING), get(MODELS)]);
  const list = parsePricing(pricing);
  if (Object.keys(list).length < 10) throw new Error('The pricing page did not parse: fewer than 10 models found. Its format changed; check it by hand.');
  return { checkedAt: new Date().toISOString(), sources: { pricing: PAGE, models: 'https://aistudio.google.com/docs/models' }, gemini: { models: list, aliases: parseAliases(models) } };
}

// Run only when called as a tool, not when its readers are imported (tools/test-models.mjs).
const main = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
const fresh = main ? await build() : null;
if (!main) { /* imported */ } else if (process.argv.includes('--check')) {
  let old = null;
  try { old = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* none yet */ }
  const a = JSON.stringify(old?.gemini?.models ?? {}); const b = JSON.stringify(fresh.gemini.models);
  if (a === b) console.log(`OK: public/data/models.json matches Google's pricing page (${Object.keys(fresh.gemini.models).length} models).`);
  else {
    const was = old?.gemini?.models ?? {};
    const lines = [];
    for (const [k, v] of Object.entries(fresh.gemini.models)) if (!was[k]) lines.push(`new: ${k} (${v.state})`); else if (was[k].state !== v.state || was[k].note !== v.note) lines.push(`changed: ${k} ${was[k].state} → ${v.state}`);
    for (const k of Object.keys(was)) if (!fresh.gemini.models[k]) lines.push(`gone: ${k}`);
    console.log(`::warning::Google's Gemini pricing page changed since public/data/models.json (run node tools/verify-models.mjs): ${lines.join('; ')}`);
  }
} else {
  await writeFile(OUT, `${JSON.stringify(fresh, null, 1)}\n`);
  console.log(`Wrote public/data/models.json: ${Object.keys(fresh.gemini.models).length} models from ${PRICING}`);
}
