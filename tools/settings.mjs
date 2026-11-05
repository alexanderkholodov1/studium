// The app's settings document (settings/app) as the tools see it: the defaults of public/assets/config.js, and the
// conversion between plain values and Firestore's REST values.
import { DEFAULT_SETTINGS, domainsOf } from '../public/assets/config.js';

export { DEFAULT_SETTINGS, domainsOf };

export function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Buffer.isBuffer(v)) return { bytesValue: v.toString('base64') };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === 'number') return { doubleValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}
export const toFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toValue(v)]));

export function fromValue(v) {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields ?? {});
  return undefined;
}
export const fromFields = (f) => Object.fromEntries(Object.entries(f ?? {}).map(([k, v]) => [k, fromValue(v)]));

// The settings document with the defaults, as the tools write it.
export const defaultDocument = (by) => ({ ...DEFAULT_SETTINGS, domains: domainsOf(DEFAULT_SETTINGS), by, updated: new Date() });
