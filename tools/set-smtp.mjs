// Sends Studium's account e-mails (address confirmation, password reset) through a Gmail account instead of Firebase's
// default sender, so that they arrive from an address students recognize. Gmail needs an app password: create it in
// the Google account (two-step verification on) and keep it in a file outside the repository.
// Usage: node tools/set-smtp.mjs <gmail address> <file with the app password>
//        node tools/set-smtp.mjs --default        back to Firebase's own sender
// The password is read from the file and never printed.
import { readFileSync } from 'node:fs';
import { accessToken, call, project } from './google.mjs';

const id = project();
const token = await accessToken();
const url = (mask) => `https://identitytoolkit.googleapis.com/admin/v2/projects/${id}/config?updateMask=${mask}`;

if (process.argv[2] === '--default') {
  await call(token, 'PATCH', url('notification.sendEmail.method'), { notification: { sendEmail: { method: 'DEFAULT' } } });
  console.log(`${id} sends its e-mails through Firebase's default sender again`);
  process.exit(0);
}

const [sender, file] = process.argv.slice(2);
if (!/^[^@\s]+@gmail\.com$/.test(sender ?? '') || !file) throw new Error('Usage: node tools/set-smtp.mjs <gmail address> <file with the app password>');
const password = readFileSync(file, 'utf8').replace(/\s+/g, '');
if (!/^[a-z]{16}$/i.test(password)) throw new Error('The file does not hold a 16-letter app password');

await call(token, 'PATCH', url('notification.sendEmail.method,notification.sendEmail.smtp,notification.sendEmail.verifyEmailTemplate.senderDisplayName'), {
  notification: {
    sendEmail: {
      method: 'CUSTOM_SMTP',
      smtp: { senderEmail: sender, host: 'smtp.gmail.com', port: 587, username: sender, password, securityMode: 'START_TLS' },
      verifyEmailTemplate: { senderDisplayName: 'Studium' },
    },
  },
});
console.log(`${id} now sends its e-mails as ${sender} through Gmail`);
