// Makes an account an admin of Studium (the custom claim admin: true), or takes the role away. An admin reads all of
// Studium whatever its address, changes the settings and moderates from the admin panel (#/admin).
// Usage: node tools/set-admin.mjs <email>            make it an admin, creating the account if it does not exist
//        node tools/set-admin.mjs <email> --remove   take the role away
// A new account gets a random password, written to private/<email>-password.txt (outside the repository) and never
// printed. The role reaches the browser at the next sign-in.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { accessToken, call, project } from './google.mjs';

const [email, flag] = process.argv.slice(2);
if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email ?? '')) throw new Error('Usage: node tools/set-admin.mjs <email> [--remove]');
const remove = flag === '--remove';
const id = project();
const token = await accessToken();
const api = `https://identitytoolkit.googleapis.com/v1/projects/${id}`;

let user = (await call(token, 'POST', `${api}/accounts:lookup`, { email: [email] })).users?.[0];
if (!user) {
  if (remove) { console.log(`${email} has no account: nothing to take away`); process.exit(0); }
  const password = randomBytes(18).toString('base64url');
  const created = await call(token, 'POST', `${api}/accounts`, { email, password, emailVerified: true });
  mkdirSync(new URL('../private/', import.meta.url), { recursive: true });
  const file = new URL(`../private/${email}-password.txt`, import.meta.url);
  writeFileSync(file, `${password}\n`, { mode: 0o600 });
  console.log(`Created the account ${email}; its password is in private/${email}-password.txt`);
  user = { localId: created.localId, customAttributes: '{}' };
}
const claims = JSON.parse(user.customAttributes || '{}');
if (remove) delete claims.admin; else claims.admin = true;
await call(token, 'POST', `${api}/accounts:update`, { localId: user.localId, customAttributes: JSON.stringify(claims) });
console.log(remove ? `${email} is no longer an admin` : `${email} is an admin of ${id} (from its next sign-in)`);
