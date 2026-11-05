// The app's settings: the communities and their address domains, whether a confirmed address is required, the page's
// switches, the AI providers offered, an announcement and the admin panel's Google client. The live ones are
// settings/app in Firestore, which only admins change (every change also goes to the audit log); until they load, the
// defaults of config.js apply.
import { doc, getDoc, collection, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore-lite.js';
import { db } from './data.js';
import { DEFAULT_SETTINGS, domainsOf } from './config.js';

const PROVIDERS = ['anthropic', 'openai', 'gemini'];
const LEVELS = ['info', 'good', 'warn'];
const clip = (v, n) => String(v ?? '').slice(0, n);
const slug = (v) => clip(v, 30).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
export const domainOf = (email) => String(email ?? '').toLowerCase().split('@')[1] ?? '';
const domainOk = (d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d);

// Whatever arrives (the database, the panel's form), shaped as the rules accept it.
export function normalize(raw = {}) {
  const d = { ...DEFAULT_SETTINGS, ...raw };
  const communities = (Array.isArray(d.communities) ? d.communities : []).slice(0, 30).map((c) => ({
    id: slug(c.id || c.name) || 'comunidad', name: clip(c.name, 40).trim() || 'Comunidad', full: clip(c.full, 120).trim(),
    domains: [...new Set((Array.isArray(c.domains) ? c.domains : []).map((x) => String(x).trim().toLowerCase().replace(/^@/, '')).filter(domainOk))].slice(0, 20),
    active: c.active !== false,
  }));
  return {
    communities: communities.length ? communities : structuredClone(DEFAULT_SETTINGS.communities),
    confirmEmail: d.confirmEmail === true,
    flags: { ...DEFAULT_SETTINGS.flags, ...(d.flags && typeof d.flags === 'object' ? d.flags : {}) },
    providers: (Array.isArray(d.providers) ? d.providers : PROVIDERS).filter((p) => PROVIDERS.includes(p)),
    announcement: {
      on: d.announcement?.on === true, text: clip(d.announcement?.text, 280),
      level: LEVELS.includes(d.announcement?.level) ? d.announcement.level : 'info',
    },
    googleClientId: clip(d.googleClientId, 120).trim(),
    updated: d.updated ?? null, by: d.by ?? '',
  };
}

let current = normalize(DEFAULT_SETTINGS);
const listeners = new Set();
const emit = () => { for (const fn of listeners) fn(current); };

export const settings = {
  get: () => current,
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  // After sign-in. Without the document (or without access), the defaults stay.
  async load() {
    try {
      const snap = await getDoc(doc(db, 'settings', 'app'));
      if (snap.exists()) current = normalize(snap.data());
    } catch (error) { console.warn('settings not loaded', error); }
    emit();
    return current;
  },
  // Admins only (the rules check it). The change and its audit entry are written together.
  async save(next, email, action, detail = '') {
    const s = normalize(next);
    const data = {
      communities: s.communities, domains: domainsOf(s), confirmEmail: s.confirmEmail, flags: s.flags, providers: s.providers,
      announcement: s.announcement, googleClientId: s.googleClientId, updated: serverTimestamp(), by: email,
    };
    const batch = writeBatch(db);
    batch.set(doc(db, 'settings', 'app'), data);
    batch.set(doc(collection(db, 'audit')), { action: clip(action, 60), detail: clip(detail, 2000), by: email, at: serverTimestamp() });
    await batch.commit();
    current = normalize({ ...data, updated: new Date() });
    emit();
    return current;
  },
};

// The active community an address belongs to, if any.
export const communityOf = (email, s = current) => s.communities.find((c) => c.active && c.domains.includes(domainOf(email))) ?? null;
// A flag of the page (hints, easter eggs, radio, bubbles).
export const flag = (name) => current.flags[name] !== false;
// How the page names the person's community («Comunidad USFQ»), or Studium for an admin of no community.
export const communityLabel = (email) => { const c = communityOf(email); return c ? `Comunidad ${c.name}` : 'Studium'; };
