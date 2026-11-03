# Studium

Interactive study guides, organized by course, term and professor. The portfolio serves Studium at
`alexanderkholodov.web.app/studium`, mounted from this repository's latest GitHub Release.

## Layout

- `public/index.html`, `public/assets/catalog.css`, `public/assets/catalog.js`: the catalog. The `GUIDES` list in
  `catalog.js` is the single source for what is published. The catalog loads its assets from `/studium/assets/`.
- `public/<university>/<course>/<term>/<evaluation>/index.html`: one self-contained guide each.
- `tools/check.mjs`: checks `public/`. Every root-absolute resource must stay inside `/studium/` (the portfolio's
  rule for mounted apps), every catalog entry must have its guide, and no key material or symbolic links are allowed.
- `tools/pack.sh <version> <commit>`: builds `studium-dist-v<version>.tar.gz`, `version.json` and `SHA256SUMS`.

## How changes ship

1. Work on a branch. Commits may carry any working version.
2. When a milestone is complete, open a pull request titled `vX.Y.Z: <what it delivers>`. `Checks` runs on every push
   and pull request.
3. The operator merges. `Release on merge` then checks and packs the merge commit and publishes the GitHub Release
   `vX.Y.Z`. Nothing is published without that merge.
4. The portfolio mounts the latest release on its next deploy.

## Adding a guide

Put it at `public/<university>/<course>/<term>/<evaluation>/index.html` and add its entry to `GUIDES` in
`public/assets/catalog.js`.
