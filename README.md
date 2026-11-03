# Studium

Interactive study guides, organized by course, term and professor. The portfolio serves Studium at
`alexanderkholodov.web.app/studium`, mounted from this repository's latest GitHub Release.

The guides are not in this repository. They live in the project's Firestore database and are readable only by
signed-in accounts whose e-mail address is verified and belongs to the allowed domain. This repository holds the app
shell (sign-in, catalog, viewer), the database rules and the admin tools.

## Layout

- `public/index.html`, `public/assets/`: the app. It signs people in with Firebase Authentication (e-mail and
  password, with e-mail confirmation), reads the catalog from `catalog/`, and opens one guide at a time from
  `guides/{id}` in a sandboxed frame that cannot reach the page or the account. Assets load from `/studium/assets/`.
- `public/assets/config.js`: the public web configuration and the allowed domain. A Firebase web API key is public by
  design; access is decided by the rules.
- `firestore.rules`: verified accounts of the allowed domain may read the catalog and get one guide at a time;
  nobody writes from a browser.
- `tools/check.mjs`: checks `public/` before a release. Only the app shell may ship (no guide pages), every
  root-absolute resource stays inside `/studium/`, no key material except the web key in `config.js`, and the domain
  in `config.js` matches the one the rules enforce.
- `tools/deploy-rules.mjs`: publishes `firestore.rules` (skipped when the live rules are identical).
- `tools/test-rules.mjs`: tests the live rules with temporary accounts (verified, unverified, other domain,
  look-alike domain, none) and deletes them afterwards.
- `tools/upload-guide.mjs <meta.json> <guide.html>`: publishes or replaces a guide and its catalog entry in one
  atomic write; `--remove <id>` takes one down.
- `tools/pack.sh <version> <commit>`: builds `studium-dist-v<version>.tar.gz`, `version.json` and `SHA256SUMS`.

The admin tools read the service-account key from `GOOGLE_SERVICE_ACCOUNT_JSON` (its content) or
`GOOGLE_APPLICATION_CREDENTIALS` (a path), refuse a key for any project other than the one in `.firebaserc`, and never
print it.

## Publishing a guide

A guide is one self-contained HTML file. Describe it in a `meta.json`:

```json
{ "id": "school-course-term-evaluation", "course": "…", "code": "…", "university": "…", "term": "…",
  "professor": "…", "title": "…", "date": "YYYY-MM-DD", "topics": ["…"] }
```

and run `node tools/upload-guide.mjs meta.json guide.html`. It is stored gzip-compressed (a document holds at most
1 MiB) and appears in the catalog at once; no release is needed.

## How changes ship

1. Work on a branch. Commits may carry any working version.
2. When a milestone is complete, open a pull request titled `vX.Y.Z: <what it delivers>`. `Checks` runs on every push
   and pull request.
3. The operator merges. `Release on merge` then checks the merge commit, publishes and tests the database rules, and
   publishes the GitHub Release `vX.Y.Z`. Nothing is published without that merge.
4. The portfolio mounts the latest release on its next deploy.
