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

Each person connects their AI in Settings in whatever way they have, as many ways as they like (`public/assets/ai.js`):
- **Gemini, free:** a key from Google AI Studio, made in a minute with any Google account and no card. Google's daily
  limits apply, and on the free plan Google may use what it receives.
- **The local bridge, with their subscription:** `bridge.mjs`, downloaded from Studium and run with
  `node studium-bridge.mjs`, lets the page use the Claude Code, Codex or Antigravity already signed in on their computer,
  with no API. It listens on 127.0.0.1 only, answers only Studium's origins and only with the code it prints (its link
  pairs it), runs each CLI read-only in a folder of its own that it deletes, and one request at a time per CLI.
- **OpenRouter** (free models) and **Puter**, each signed in with one click.
- **An API key** of Claude, ChatGPT or Gemini, which bills per use.
- **The chat**, with no connection at all (a free Claude account included): every part comes with its instructions, to
  take to any chat and paste back.

Keys and sign-ins are kept only in that browser; Studium charges nothing. Where, which model and which effort are
chosen when the AI is used: the page proposes the best of what the person has for each task (a subscription for many
files, the strongest model for a guide, a light one to identify a document), says why, and remembers the last choice
per task. A provider's error is said in words (`aierror.js`): an API account without balance says that a subscription
does not include the API and offers the other ways. The admins can switch each way off from the panel. With it,
Studium:
- turns files, or a whole folder, into contributions with Studium's instructions (`contribute.js`, `files.js`);
- answers questions about the map in words, with a compact index of it (`route.js`);
- creates guides from the map's context, with the student's goal, level, language, style and extra sections;
- identifies documents shared in the library (`library.js`, with pdf.js reading the first pages in the browser);
- edits the owner's guides piece by piece: one section, a new section, or the whole guide (`editor.js`).
Guides record who signed them (optional) and which AI, model and effort made them.

The library (`#/biblioteca`) holds shared course documents as links only (Drive, OneDrive, Dropbox): Studium stores no
file. Professors' cards open their question bank, grouped by evaluation.

The interface is in Spanish and English (`i18n.js`, `en.js`): the page is written in Spanish and translated as it renders.

## Communities and admins

The live settings are one document, `settings/app`, which the rules read: the communities and the address domains of
each (USFQ: `estud.usfq.edu.ec` and `alumni.usfq.edu.ec`), whether a confirmed address is required, the page's switches,
the AI providers offered and an announcement. `public/assets/config.js` holds their defaults, and
`tools/deploy-rules.mjs` creates the document from them when it is missing.

Admins are accounts with the custom claim `admin: true` (`tools/set-admin.mjs`). They read everything whatever their
address and use the admin panel (`#/admin`, `admin.js`): settings and communities, content moderation, presence and
counts, the easter eggs, the audit log, and, with their own Google sign-in from the browser, the accounts and
Firestore's usage. Everything in the panel is fetched on demand; nothing runs on a timer.

Today all communities share one pool of content. A pool per community needs a `community` field on what members
publish, and the rules and queries to match it.

## How content gets in

Students use their own AI (ChatGPT, Gemini, Claude, Copilot, NotebookLM…). Studium gives it the instructions and reads
back what it returns:

- **Contributions.** Exams, homework, labs, slides, notes, summaries, books, syllabi, contest problems or a curriculum
  go to the person's AI with Studium's instructions. The AI returns a compact JSON extract in the standard of
  `standard.js` and `prompts.js` (version 2):
  - the evaluation the material belongs to (`stage`);
  - its concepts in the order it teaches them, each with one standard name, its other names (`aka`), its unit, what
    must be known before it (`needs`) and its other relations;
  - its questions (with their number and evaluation), worked examples and how it teaches or evaluates;
  - for a syllabus, its units, the evaluation that covers each one and the evaluations themselves.

  The original files never reach Studium. Before publishing, the app looks for personal data and offers to remove it,
  and warns when the same file (by its fingerprint) or the same exam is already on the map.
- **Any file.** `files.js` reads in the browser whatever is dropped and splits it into parts the AI accepts:
  - PDFs, split by their chapters. A long book sends its index first, and its chapters wait until the person picks
    them. Scans and photos go as pictures, cut in quarters when the writing is small.
  - Photos, joined when they are pages of the same exam.
  - Word, PowerPoint, Excel, OpenDocument and EPUB, unzipped and read as text, with some of their figures.
  - Notebooks, code (one material per folder), text and ZIPs.

  Every part waits in **the queue** (`queue.js`), as many files as the person drops. The queue lives in the browser
  (IndexedDB), so a reload, a closed tab or a crash resumes where it stopped, and one tab runs it at a time. It waits
  out a rate limit as long as the provider asks, pauses a whole day's limit until its reset and resumes alone, retries
  network failures a few times, and stops on an account problem until the person acts. When the browser has no room
  for the files, it keeps its place and asks for the same files again, matched by fingerprint. Without an AI connected,
  each part waits for the chat: copy its instructions, download it, paste the answer back. Every answer waits for
  review, and «Publicar todo lo listo» publishes at once those with nothing personal to check.
- **Guides.** Studium exports the part of the map a guide needs (a Markdown context file) and the instructions, with
  settings for level, length, practice, difficulty and examples. The AI returns one HTML file with a JSON block that
  names the concepts it explains and the sections where it explains them.

Everything a person publishes is public by default, or private to their account. Neither a guide nor a contribution
names its author.

Material that comes from a shared collection keeps its credit: the collection is a **source** (name, description,
acknowledgment and a link to the original), shown on the Sources page and next to the courses it contributed to.

## The map

`public/assets/graph.js` joins every guide, contribution and library document an account can see into one graph of
careers, courses, concepts, guides, materials and documents.
- **Joining.** Concepts join by name, by alias and regardless of plurals; courses by code and name; professors by
  name.
- **The timeline.** Each concept is placed on its course's timeline: the earliest evaluation it appears in, from the
  materials or from a syllabus.
- **Drawing.** The view draws thousands of nodes as islands per course, grouped by area. It uses Barnes-Hut forces, a
  layout that settles across frames, culling, and labels placed on a grid.

`mapui.js` holds its controls:
- **The bar.** Search that also answers questions in words: with the person's AI, or with a simple reader of common
  phrasings.
- **Filters.** Courses, professors, terms, up to an evaluation, sources and kinds of material, and the person's own
  courses and interests.
- **Views.**
  - The ones that light the map up: most asked, difficulty, bridges, what you grew, what you lack, gaps, new, by
    professor.
  - A course's timeline, and the curriculum.
- **Selection** of one or many nodes, with hiding, focusing and «Ya lo sé».
- **Routes and paths** (`route.js`):
  - A route gathers everything needed for an evaluation, across courses, and stops there.
  - A guide can be made from any route or selection.
  - There is also the path between two concepts.

**Reads.** A visit reads the map from packs (`packs.js`): every public contribution in a few documents, compiled on
demand by an admin from the panel or with `tools/compile-packs.mjs`. The browser keeps them (`cache.js`) and then
reads only what changed; removal records drop what stopped being public.

## Layout

- `public/index.html`, `public/assets/`: the app. `app.js` (sign-in, routes, guides), `data.js`
  (Firestore), `graph.js` (the map's graph and drawing), `mapui.js` (the map's controls), `route.js` (routes, paths,
  questions in words), `standard.js` (evaluations, terms, concept names), `files.js` (any file, read in the browser),
  `packs.js` and `cache.js` (the map's reads), `contribute.js` (contributing), `queue.js` (the queue of material),
  `ai.js` and `aierror.js` (every way to the person's AI, and its errors in words), `bridge.mjs` (the local bridge a
  person downloads and runs with Node; not loaded by the page), `prompts.js` (the instructions for the
  AI and the readers of what it returns), `viewer.js` (guides run in a sandboxed frame under a fixed content policy),
  `themes.js` (each course's colors and motif), `fx.js` (the scene, tilting cards, glass, transitions), `play.js`
  (floating tokens with physics, the companion, bubbles, confetti, the springy wordmark), `sfx.js` (synthesized
  sounds), `prefs.js` (the person's settings, synced to `profiles/{uid}`), `space.js` (home, goals, timer,
  settings), `community.js` (thanks and professors), `demos.js` (the landing's live examples). A release serves the
  assets from `/studium/assets/<version>/`, so a new version always reaches returning visitors.
- `public/assets/config.js`: the public web configuration, the allowed domain, and `confirmEmail`, the sign-up flow
  setting (address confirmation and password recovery by e-mail). A Firebase web API key is public by design; access
  is decided by the rules.
- `firestore.rules`: who reads and writes each collection (`catalog`, `guides`, `contributions`, `owners`, `sources`,
  `profiles`, `kudos`, `tips`, `library`, `packs`, `removed`, `settings`, `audit`, `presence`, `eggs`), what a document
  may contain, and how public and private documents are listed. `firestore.indexes.json`: the composite index the map
  needs, created by `tools/deploy-rules.mjs`.
- `tools/check.mjs`: checks `public/` before a release. Only the app may ship (no guide pages), every root-absolute
  resource stays inside `/studium/`, no key material except the web key in `config.js`, the default settings have an
  active community, and the rules read the live ones.
- `tools/test-queue.mjs`: tests the queue (a reload in the middle, rate and daily limits, an account without balance,
  retries, files without room, the chat, two tabs) and what each provider's errors mean, with a store in memory.
- `tools/test-bridge.mjs`: tests the local bridge with fake CLIs (`.cmd` shims on Windows): origins, the pairing code,
  read-only runs, limits, models refused, timeouts, hostile file names, one run at a time.
- `tools/test-rules.mjs`: tests the rules with temporary accounts and documents, and deletes them afterwards; with
  `--emulators`, against the local emulators instead of the live project.
- `tools/deploy-rules.mjs`: publishes `firestore.rules` (skipped when the live rules are identical), creating
  `settings/app` with the defaults first when it is missing.
- `tools/set-admin.mjs <email> [--remove]`: makes an account an admin (creating it if needed, with a random password
  written to `private/`), or takes the role away.
- `tools/set-email-links.mjs <url> | --default`: where the links of the account e-mails open (Firebase may refuse it).
- `tools/upload-guide.mjs <meta.json> <guide.html>`: publishes or replaces a guide as an administrator;
  `--remove <id>` takes one down.
- `tools/upload-contribution.mjs <aporte.json> [--source <id>] [--original <file>] [--owner <e-mail>]`: publishes a
  contribution as an administrator, read and checked with the app's own reader (`--dry-run` only checks it).
  `--original` computes the original file's fingerprint as the app does (`tools/fingerprint.mjs`; `--part i --of n` for
  a part), and a fingerprint already in the database stops the upload. `--owner` gives it to that account, as if
  published from the site. `--remove <id>` takes one down.
- `tools/test-fingerprint.mjs`: checks that the tools' fingerprint equals the app's (one file, a file over 64 MB, a group
  of photos, the parts of a file).
- `tools/upload-source.mjs <source.json>`: publishes or updates a source and its credits.
- `tools/compile-packs.mjs [--dry-run]`: compiles the map's packs (as «Compilar ahora» in the admin panel does).
- `tools/set-smtp.mjs <gmail address> <file with the app password>`: sends the account e-mails (address confirmation,
  password reset) through that Gmail account; `--default` goes back to Firebase's own sender.
- `tools/set-owner.mjs <id> <e-mail>`: gives a guide or contribution published with the admin tools to an account, so
  that its owner can change, replace or delete it from the site, keeping its evaluation, source and fingerprint.
- `tools/dev.mjs [--emulators]`: serves the app at `http://localhost:5173/studium/`, against the live project or the
  local emulators.
- `tools/pack.sh <version> <commit> [out] [previous tarball]`: builds `studium-dist-v<version>.tar.gz`, `version.json`
  and `SHA256SUMS`, with the assets under `assets/<version>/` and the previous release's kept beside them.

The admin tools read the service-account key from `GOOGLE_SERVICE_ACCOUNT_JSON` (its content) or
`GOOGLE_APPLICATION_CREDENTIALS` (a path), refuse a key for any project other than the one in `.firebaserc`, and never
print it. With that key a tool can also sign in as an account (`customToken()` in `tools/google.mjs`), which the rules
accept like a password sign-in, to publish material in someone's name through the app itself.

## Working locally

A private preview, with its own emulated database, demo data and accounts (never the live project):

```sh
node tools/preview.mjs                     # http://localhost:5173/studium/ ; Java 21 for the emulators
node tools/preview.mjs --guide guia.html   # with that file as one of the demo guides
```

Accounts, all with the password `prueba123`: `prueba@estud.usfq.edu.ec` (a student), `otra@estud.usfq.edu.ec`, and
`studiumplatform@gmail.com` (an admin). Or step by step:

```sh
firebase emulators:start --only auth,firestore
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
