#!/usr/bin/env bash
# Usage: tools/pack.sh <version, without the v> <40-character commit SHA> [output directory] [previous release tarball]
# Packs public/ with a generated version.json into studium-dist-v<version>.tar.gz, and writes version.json
# and SHA256SUMS beside it: the release contract the portfolio mounts at /studium.
#
# The assets go under assets/<version>/ and index.html points there. The portfolio serves /studium/assets/* as
# immutable for a year, so a fixed name would keep returning visitors on old code; a folder per version never does.
# When the previous release's tarball is given, its assets ship too (its versioned folder, or its flat files for a
# release older than this scheme): a page still cached from the previous version keeps finding its own code until
# its index.html expires.
set -euo pipefail
version="$1"
commit="$2"
out="${3:-out}"
previous="${4:-}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || { echo "Not a version: $version" >&2; exit 1; }
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "Not a commit SHA: $commit" >&2; exit 1; }
stage="$(mktemp -d)"
mkdir -p "$out"
cp -R public/. "$stage/"

# The previous release's own assets, kept beside the new ones.
if [[ -n "$previous" && -f "$previous" ]]; then
  old="$(mktemp -d)"
  tar -xzf "$previous" -C "$old"
  prev_version="$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$old/version.json" 2>/dev/null || true)"
  if [[ -n "$prev_version" && -d "$old/assets/$prev_version" ]]; then
    mkdir -p "$stage/.previous/$prev_version" && cp -R "$old/assets/$prev_version/." "$stage/.previous/$prev_version/"
  elif [[ -d "$old/assets" ]]; then
    mkdir -p "$stage/.previous/flat" && find "$old/assets" -maxdepth 1 -type f -exec cp {} "$stage/.previous/flat/" \;
  fi
  rm -rf "$old"
fi

# This version's assets, in their own folder.
mkdir -p "$stage/.assets-$version"
mv "$stage/assets/"* "$stage/.assets-$version/"
rm -rf "$stage/assets"
mkdir -p "$stage/assets"
mv "$stage/.assets-$version" "$stage/assets/$version"
if [[ -d "$stage/.previous" ]]; then
  for dir in "$stage/.previous/"*; do
    name="$(basename "$dir")"
    if [[ "$name" == flat ]]; then cp -R "$dir/." "$stage/assets/"; else mkdir -p "$stage/assets/$name" && cp -R "$dir/." "$stage/assets/$name/"; fi
  done
  rm -rf "$stage/.previous"
fi
sed -i.bak "s#/studium/assets/#/studium/assets/$version/#g" "$stage/index.html" && rm -f "$stage/index.html.bak"
grep -q "/studium/assets/$version/app.js" "$stage/index.html" || { echo "index.html does not load the versioned assets" >&2; exit 1; }

printf '{"name":"studium","version":"%s","commit":"%s","builtAt":"%s"}\n' "$version" "$commit" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$stage/version.json"
(cd "$stage" && tar -czf - *) > "$out/studium-dist-v${version}.tar.gz"
cp "$stage/version.json" "$out/version.json"
(cd "$out" && sha256sum "studium-dist-v${version}.tar.gz" version.json > SHA256SUMS)
rm -rf "$stage"
cat "$out/SHA256SUMS"
