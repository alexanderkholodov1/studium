// Public web configuration. A Firebase web API key identifies the project and is public by design: access is
// decided by firestore.rules, not by this key. This file is the only place in public/ where a key may appear.
export const firebaseConfig = {
  apiKey: 'AIzaSyDfxdur8_R5hKzVGuEwcFvOquXqjkOKfAA',
  authDomain: 'studium101.firebaseapp.com',
  projectId: 'studium101',
  appId: '1:921417767106:web:15e83839e0a7216dc8435b',
};

// Only verified accounts of this domain can read guides. firestore.rules enforces the same domain;
// tools/check.mjs fails if the two ever differ.
export const allowedDomain = 'estud.usfq.edu.ec';

// Whether an account must confirm its address through an e-mailed link before it can read guides. Off while the
// school's mail server drops the sign-in e-mails; then the domain and the password are the only checks.
// firestore.rules must agree (email_verified is required exactly when this is on); tools/check.mjs enforces it.
export const confirmEmail = false;
export const audience = 'estudiantes de la USFQ';
