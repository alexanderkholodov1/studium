// Gives a guide or a contribution published with the admin tools to an account, so that its owner can change its
// visibility, replace it or delete it from the site. The documents are rewritten with exactly the fields the site
// writes (the rules check them on every change), and the owner record is created.
// Usage: node tools/set-owner.mjs <id> <e-mail of the account>
import { accessToken, call, project } from './google.mjs';

const [docId, email] = process.argv.slice(2);
if (!docId || !email) throw new Error('Usage: node tools/set-owner.mjs <id> <e-mail of the account>');
const id = project();
const base = `projects/${id}/databases/(default)/documents`;
const api = `https://firestore.googleapis.com/v1/${base}`;
const token = await accessToken();

const found = await call(token, 'POST', `https://identitytoolkit.googleapis.com/v1/projects/${id}/accounts:lookup`, { email: [email] });
const uid = found.users?.[0]?.localId;
if (!uid) throw new Error(`No account with the e-mail ${email}`);

const get = (path) => call(token, 'GET', `${api}/${path}`).catch((error) => { if (error.status === 404) return null; throw error; });
const keep = (doc, names) => Object.fromEntries(names.filter((k) => doc.fields[k] !== undefined).map((k) => [k, doc.fields[k]]));
const stamped = (path, fields) => ({
  update: { name: `${base}/${path}`, fields },
  updateTransforms: [{ fieldPath: 'updated', setToServerValue: 'REQUEST_TIME' }],
});

const writes = [];
const entry = await get(`catalog/${docId}`);
const guide = await get(`guides/${docId}`);
const contribution = await get(`contributions/${docId}`);
if (entry && guide) {
  writes.push(stamped(`catalog/${docId}`, keep(entry, ['course', 'code', 'university', 'term', 'professor', 'title', 'date', 'topics',
    'concepts', 'anchors', 'theme', 'level', 'visibility'])));
  writes.push(stamped(`guides/${docId}`, keep(guide, ['title', 'html', 'encoding', 'size', 'visibility'])));
} else if (contribution) {
  writes.push(stamped(`contributions/${docId}`, keep(contribution, ['kind', 'course', 'code', 'university', 'term', 'professor', 'title',
    'theme', 'concepts', 'questions', 'examples', 'body', 'encoding', 'visibility'])));
} else throw new Error(`No guide or contribution with the id ${docId}`);
writes.push({ update: { name: `${base}/owners/${docId}`, fields: { uid: { stringValue: uid } } } });

// A large guide can meet the database's write-bandwidth limit: retry with exponential backoff.
for (let attempt = 0; ; attempt += 1) {
  try { await call(token, 'POST', `${api}:commit`, { writes }); break; }
  catch (error) {
    if (error.status !== 429 || attempt >= 6) throw error;
    const wait = 2000 * 2 ** attempt;
    console.log(`The database asked to slow down; retrying in ${wait / 1000} s`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}
console.log(`${docId} now belongs to ${email}`);
