// Spanish and English. The page is written in Spanish; in English, every text node and the placeholders, titles and
// labels are looked up in the dictionary (en.js) as they appear, including what the app renders later. Text with
// numbers or names goes through the patterns. The guides themselves keep the language they were written in.
import { EN, PATTERNS } from './en.js';

const SKIP = 'script, style, textarea, code, pre, iframe, .no-i18n, #guide-frame, #preview-frame, #edit-preview';
const ATTRS = ['placeholder', 'title', 'aria-label', 'data-who'];
const originals = new WeakMap(); // text node -> its Spanish text
const attrOriginals = new WeakMap(); // element -> { attribute: Spanish }
let current = 'es';
let observer = null;

function english(text) {
  const key = text.trim().replace(/\s+/g, ' ');
  if (!key) return null;
  const lead = text.match(/^\s*/)[0];
  const tail = text.match(/\s*$/)[0];
  if (EN[key]) return lead + EN[key] + tail;
  // Text with numbers or names: every pattern that applies, in order.
  let out = key;
  for (const [rx, to] of PATTERNS) out = out.replace(rx, to);
  return out !== key ? lead + out + tail : null;
}
export const t = (text) => (current === 'en' ? english(text) ?? text : text);

function translateNode(node) {
  {
    if (node.parentElement?.closest(SKIP)) return;
    const base = originals.get(node) ?? node.nodeValue;
    if (current === 'en') {
      const out = english(base);
      if (out != null && node.nodeValue !== out) { originals.set(node, base); node.nodeValue = out; }
    } else if (originals.has(node)) { node.nodeValue = originals.get(node); originals.delete(node); }
    return;
  }
}
function translateAttrs(el) {
  for (const a of ATTRS) {
    if (!el.hasAttribute(a)) continue;
    const store = attrOriginals.get(el) ?? {};
    const base = store[a] ?? el.getAttribute(a);
    if (current === 'en') {
      const out = english(base);
      if (out != null && el.getAttribute(a) !== out) { store[a] = base; attrOriginals.set(el, store); el.setAttribute(a, out); }
    } else if (store[a] != null) { el.setAttribute(a, store[a]); delete store[a]; }
  }
}
function translateTree(rootNode) {
  if (rootNode.nodeType === Node.TEXT_NODE) { translateNode(rootNode); return; }
  if (rootNode.nodeType !== Node.ELEMENT_NODE || rootNode.closest(SKIP)) return;
  translateAttrs(rootNode);
  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) translateNode(n); else translateAttrs(n);
  }
  // What a person writes in a text area stays as written, but its placeholder is part of the page.
  for (const area of rootNode.querySelectorAll('textarea[placeholder]')) if (!area.closest('.no-i18n, #guide-frame')) translateAttrs(area);
}

export function setLang(lang) {
  current = lang === 'en' ? 'en' : 'es';
  document.documentElement.lang = current;
  observer?.disconnect();
  translateTree(document.body);
  document.title = t(document.title);
  for (const b of document.querySelectorAll('[data-lang-toggle] span')) b.textContent = current === 'en' ? 'EN' : 'ES';
  observer = new MutationObserver((records) => {
    observer.disconnect();
    for (const r of records) {
      if (r.type === 'characterData') translateNode(r.target);
      else if (r.type === 'attributes') translateAttrs(r.target);
      else for (const n of r.addedNodes) translateTree(n);
    }
    observe();
  });
  observe();
}
function observe() { observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS }); }
export const lang = () => current;
