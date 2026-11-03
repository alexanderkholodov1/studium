#!/usr/bin/env bash
# Usage: tools/pack.sh <version, without the v> <40-character commit SHA> [output directory]
# Packs public/ with a generated version.json into studium-dist-v<version>.tar.gz, and writes version.json
# and SHA256SUMS beside it: the release contract the portfolio mounts at /studium.
set -euo pipefail
version="$1"
commit="$2"
out="${3:-out}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || { echo "Not a version: $version" >&2; exit 1; }
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "Not a commit SHA: $commit" >&2; exit 1; }
stage="$(mktemp -d)"
mkdir -p "$out"
cp -R public/. "$stage/"
printf '{"name":"studium","version":"%s","commit":"%s","builtAt":"%s"}\n' "$version" "$commit" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$stage/version.json"
(cd "$stage" && tar -czf - *) > "$out/studium-dist-v${version}.tar.gz"
cp "$stage/version.json" "$out/version.json"
(cd "$out" && sha256sum "studium-dist-v${version}.tar.gz" version.json > SHA256SUMS)
rm -rf "$stage"
cat "$out/SHA256SUMS"
