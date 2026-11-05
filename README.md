# Studium

A personal space to study anything, and a community of students who share guides, notes and what they know of each
professor. The portfolio serves Studium at `alexanderkholodov.web.app/studium`, mounted from this repository's latest
GitHub Release.

The content is not in this repository. Guides and contributions live in the project's Firestore database and are
readable only by signed-in members of a community. This repository holds the app, the database rules and the admin
tools.

## What a visitor and a member see

- **Anyone:** what Studium is, its look, who made it and the community manifesto (`#/`, `#/acerca`). The sign-in page
  never names the accepted domain.
- **A member:** their own space (`#/`): the next exam with its countdown, goals with sounds and confetti, a focus timer,
  where they left off, and what is new, ordered by how they study. Their settings (`#/ajustes`): semester, career, how
  they study (exams, for fun, intensive, step by step) and the ambience (playful with a companion and bubbles, lively,
  calm, or focus in black and white), sounds and day or night. Everything they choose is kept in their account.
- **The community:** every guide as a card (`#/guias`), the knowledge map, contributing, and the professors page
  (`#/profes`). Interactions are only positive: guides get four fixed kinds of thanks and professors get fixed,
  constructive tags, counted and never signed. The database accepts nothing else, so nobody can write anything negative.

## Your own AI

Each person can connect Claude, ChatGPT or Gemini in Settings with their own API key (`public/assets/ai.js`). The key is
kept only in that browser; Studium charges nothing and the provider bills its own usage. With it, Studium:
- turns files, or a whole folder, into contributions with Studium's instructions (`contribute.js`);
- creates guides from the map's context, with the student's goal, level, language, style and extra sections;
- identifies documents shared in the library (`library.js`, with pdf.js reading the first pages in the browser);
- edits the owner's guides piece by piece: one section, a new section, or the whole guide (`editor.js`).
Guides record who signed them (optional) and which AI, model and effort made them.

The library (`#/biblioteca`) holds shared course documents as links only (Drive, OneDrive, Dropbox): Studium stores no
file. Professors' cards open their question bank, grouped by evaluation.

The interface is in Spanish and English (`i18n.js`, `en.js`): the page is written in Spanish and translated as it renders.

## Communities

Today there is one, USFQ (`communities` in `public/assets/config.js`). A second one needs its domain in `config.js` and
`firestore.rules`, and a `community` field on what its members publish so that each pool reads only its own.

## How content gets in

Students use their own AI (ChatGPT, Gemini, Claude, Copilot, NotebookLM…). Studium gives it the instructions and reads
back what it returns:

- **Contributions.** Exams, homework, slides, books, notes, contest problems or a curriculum go to the person's AI with
  Studium's instructions. The AI returns a compact JSON extract: concepts and their relations, question patterns,
  examples and how the material is taught or evaluated. The original files never reach Studium. Before publishing,
  the app looks for personal data and offers to remove it.
- **Guides.** Studium exports the part of the map a guide needs (a Markdown context file) and the instructions, with
  settings for level, length, practice, difficulty and examples. The AI returns one HTML file with a JSON block that
  names the concepts it explains and the sections where it explains them.

Everything a person publishes is public by default, or private to their account. Neither a guide nor a contribution
names its author.

Material that comes from a shared collection keeps its credit: the collection is a **source** (name, description,
acknowledgment and a link to the original), shown on the Sources page and next to the courses it contributed to.

## The map

`public/assets/graph.js` joins every guide and contribution an account can see into one graph: concepts, courses,
guides and careers. Concepts with the same name join across courses, so a concept shared by two courses links them.
A curriculum lays its courses out by semester and shows what comes next.

## Layout

- `public/index.html`, `public/assets/`: the app. `app.js` (sign-in, routes, guides, map panel), `data.js`
  (Firestore), `graph.js` (the map), `contribute.js` (contributing), `prompts.js` (the instructions for the AI and the
  readers of what it returns), `viewer.js` (guides run in a sandboxed frame under a fixed content policy),
  `themes.js` (each course's colors and motif), `fx.js` (the scene, tilting cards, glass, transitions), `play.js`
  (floating tokens with physics, the companion, bubbles, confetti, the springy wordmark), `sfx.js` (synthesized
  sounds), `prefs.js` (the person's settings, synced to `profiles/{uid}`), `space.js` (home, goals, timer,
  settings), `community.js` (thanks and professors), `demos.js` (the landing's live examples). Assets load from
  `/studium/assets/`.
- `public/assets/config.js`: the public web configuration, the allowed domain, and `confirmEmail`, the sign-up flow
  setting (address confirmation and password recovery by e-mail). A Firebase web API key is public by design; access
  is decided by the rules.
- `firestore.rules`: who reads and writes each collection (`catalog`, `guides`, `contributions`, `owners`, `sources`,
  `profiles`, `kudos`, `tips`), what a
  document may contain, and how public and private documents are listed.
- `tools/check.mjs`: checks `public/` before a release. Only the app may ship (no guide pages), every root-absolute
  resource stays inside `/studium/`, no key material except the web key in `config.js`, and the domain and
  `confirmEmail` in `config.js` match what the rules enforce.
- `tools/test-rules.mjs`: tests the rules with temporary accounts and documents, and deletes them afterwards; with
  `--emulators`, against the local emulators instead of the live project.
- `tools/deploy-rules.mjs`: publishes `firestore.rules` (skipped when the live rules are identical).
- `tools/upload-guide.mjs <meta.json> <guide.html>`: publishes or replaces a guide as an administrator;
  `--remove <id>` takes one down.
- `tools/upload-contribution.mjs <aporte.json> [--source <id>]`: publishes a contribution as an administrator, read
  and checked with the app's own reader (`--dry-run` only checks it); `--remove <id>` takes one down.
- `tools/upload-source.mjs <source.json>`: publishes or updates a source and its credits.
- `tools/set-smtp.mjs <gmail address> <file with the app password>`: sends the account e-mails (address confirmation,
  password reset) through that Gmail account; `--default` goes back to Firebase's own sender.
- `tools/set-owner.mjs <id> <e-mail>`: gives a guide or contribution published with the admin tools to an account, so
  that its owner can change, replace or delete it from the site.
- `tools/dev.mjs [--emulators]`: serves the app at `http://localhost:5173/studium/`, against the live project or the
  local emulators.
- `tools/pack.sh <version> <commit>`: builds `studium-dist-v<version>.tar.gz`, `version.json` and `SHA256SUMS`.

The admin tools read the service-account key from `GOOGLE_SERVICE_ACCOUNT_JSON` (its content) or
`GOOGLE_APPLICATION_CREDENTIALS` (a path), refuse a key for any project other than the one in `.firebaserc`, and never
print it.

## Working locally

```sh
firebase emulators:start --only auth,firestore     # Java 21 and firebase-tools
node tools/test-rules.mjs --emulators
node tools/dev.mjs --emulators
```

## How changes ship

1. Work on a branch. Commits may carry any working version.
2. When a milestone is complete, open a pull request titled `vX.Y.Z: <what it delivers>`. `Checks` runs on every push
   and pull request, including the rules tests on the emulators.
3. The operator merges. `Release on merge` then checks the merge commit, publishes and tests the database rules, and
   publishes the GitHub Release `vX.Y.Z`. Nothing is published without that merge.
4. The portfolio mounts the latest release on its next deploy.
