// Where the links of the account e-mails (address confirmation, password reset) open. Studium handles them itself
// (?mode=…&oobCode=…), on the site students already use; mail filters trust that more than a separate domain.
// Usage: node tools/set-email-links.mjs https://alexanderkholodov.web.app/studium/
//        node tools/set-email-links.mjs --default      back to Firebase's own page
// Change it only after the version that handles the links is live.
import { accessToken, call, project } from './google.mjs';

const id = project();
const target = process.argv[2];
const value = target === '--default' ? `https://${id}.firebaseapp.com/__/auth/action` : target;
if (!/^https:\/\//.test(value ?? '')) throw new Error('Usage: node tools/set-email-links.mjs <https url> | --default');
const token = await accessToken();
const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${id}/config`;
await call(token, 'PATCH', `${url}?updateMask=notification.sendEmail.callbackUri`, { notification: { sendEmail: { callbackUri: value } } });
const cfg = await call(token, 'GET', url);
console.log(`The links of ${id}'s e-mails open ${cfg.notification?.sendEmail?.callbackUri}`);
