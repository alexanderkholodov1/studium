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
export const audience = 'estudiantes de la USFQ';
