// Public web configuration. A Firebase web API key identifies the project and is public by design: access is
// decided by firestore.rules, not by this key. This file is the only place in public/ where a key may appear.
export const firebaseConfig = {
  apiKey: 'AIzaSyDfxdur8_R5hKzVGuEwcFvOquXqjkOKfAA',
  authDomain: 'studium101.firebaseapp.com',
  projectId: 'studium101',
  appId: '1:921417767106:web:15e83839e0a7216dc8435b',
};

// Only accounts of this domain can read guides. firestore.rules enforces the same domain;
// tools/check.mjs fails if the two ever differ. The site never shows it: members of a community already know it.
export const allowedDomain = 'estud.usfq.edu.ec';

// The communities: each one is the pool of students that share guides, the map and what they know of their professors.
// Today there is one. A second one needs its own domain here and in firestore.rules, and a community field on what its
// members publish, so that each pool reads only its own.
export const communities = [
  { id: 'usfq', name: 'USFQ', full: 'Universidad San Francisco de Quito', domain: allowedDomain },
];

// Sign-up flow: whether an account confirms its address through an e-mailed link, and may recover its password by
// e-mail. firestore.rules follows the same setting; tools/check.mjs fails if the two ever differ.
export const confirmEmail = true;
// The address those e-mails come from, as the confirmation screen names it (tools/set-smtp.mjs sets the sender).
export const mailFrom = 'studiumplatform@gmail.com';
