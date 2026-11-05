// Public web configuration. A Firebase web API key identifies the project and is public by design: access is
// decided by firestore.rules, not by this key. This file is the only place in public/ where a key may appear.
export const firebaseConfig = {
  apiKey: 'AIzaSyDfxdur8_R5hKzVGuEwcFvOquXqjkOKfAA',
  authDomain: 'studium101.firebaseapp.com',
  projectId: 'studium101',
  appId: '1:921417767106:web:15e83839e0a7216dc8435b',
};

// The settings the page starts with. The live ones are a document in Firestore (settings/app) that the admins change
// from the admin panel, and the database rules read only that document. tools/deploy-rules.mjs creates it from these
// defaults when it does not exist yet. The site never lists the accepted domains: members already know them.
export const DEFAULT_SETTINGS = {
  // Each community is a group of students, with the address domains that belong to it.
  communities: [
    { id: 'usfq', name: 'USFQ', full: 'Universidad San Francisco de Quito', domains: ['estud.usfq.edu.ec', 'alumni.usfq.edu.ec'], active: true },
  ],
  // Whether an account must confirm its address before it can read. Off since 0.4.5: Microsoft 365 holds the
  // confirmation e-mails, so the requirement only kept students out.
  confirmEmail: false,
  // Switches of the page, for everyone.
  flags: { hints: true, eggs: true, radio: true, bubbles: false },
  // The AI providers members may connect.
  providers: ['anthropic', 'openai', 'gemini'],
  // A message shown to every member at the top of the page.
  announcement: { on: false, text: '', level: 'info' },
  // The OAuth client ID that lets the admin panel read Google Cloud data (accounts, usage) with the admin's own Google
  // sign-in. Public by design, like the web API key; set from the panel.
  googleClientId: '',
};
// Every accepted domain of the active communities: the list the rules check.
export const domainsOf = (s) => [...new Set(s.communities.filter((c) => c.active).flatMap((c) => c.domains.map((d) => d.toLowerCase())))];

// The address the account e-mails come from, as the confirmation screen names it (tools/set-smtp.mjs sets the sender).
export const mailFrom = 'studiumplatform@gmail.com';
