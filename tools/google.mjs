// Access token for the project's service account, for the admin tools. The key comes from
// GOOGLE_SERVICE_ACCOUNT_JSON (its content, as in CI) or GOOGLE_APPLICATION_CREDENTIALS (a path, as on a laptop).
// Neither the key nor the token is ever printed.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function project() {
  return JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8')).projects.default;
}

function serviceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    || (process.env.GOOGLE_APPLICATION_CREDENTIALS && readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  if (!raw) throw new Error('Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS to the service-account key');
  const key = JSON.parse(raw);
  // A key for another project would write somewhere unexpected: refuse it.
  if (key.project_id !== project()) throw new Error('The service-account key belongs to a different project than .firebaserc');
  return key;
}

export async function accessToken() {
  const key = serviceAccount();
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: key.client_email, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/datastore',
  };
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  const body = await response.json();
  if (!body.access_token) throw new Error(`Could not get an access token: ${body.error ?? response.status}`);
  return body.access_token;
}

// JSON request to a Google API. Errors carry the status and the API's message, never the token.
export async function call(token, method, url, body) {
  const response = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(`${method} ${new URL(url).pathname}: HTTP ${response.status} ${data.error?.message ?? ''}`.trim());
    error.status = response.status;
    throw error;
  }
  return data;
}
