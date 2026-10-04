#!/usr/bin/env bash
set -euo pipefail

branch="${READ_CACHE_BRANCH:-read-cache}"
source_dir="${READ_CACHE_SOURCE_DIR:-out/api/v1}"
source_sha="${READ_CACHE_SOURCE_SHA:-${GITHUB_SHA:-}}"

root="$(git rev-parse --show-toplevel)"
cd "$root"

if [ -z "$source_sha" ]; then
  source_sha="$(git rev-parse HEAD)"
fi
if ! printf '%s' "$source_sha" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "READ_CACHE_SOURCE_SHA must be a 40-character git SHA" >&2
  exit 1
fi
if [ ! -d "$source_dir" ]; then
  echo "read-cache source directory is missing: $source_dir" >&2
  exit 1
fi
for required in index.json bootstrap.json attention.json; do
  if [ ! -f "$source_dir/$required" ]; then
    echo "read-cache source is missing $required" >&2
    exit 1
  fi
done
if find "$source_dir" -type l -print -quit | grep -q .; then
  echo "read-cache source must not contain symlinks" >&2
  exit 1
fi
if find "$source_dir" -type f ! -name '*.json' -print -quit | grep -q .; then
  echo "read-cache source may contain JSON files only" >&2
  exit 1
fi

tmp="$(mktemp -d)"
worktree="$tmp/worktree"
cleanup() {
  git worktree remove --force "$worktree" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

if git ls-remote --exit-code --heads origin "refs/heads/$branch" >/dev/null 2>&1; then
  git fetch --no-tags origin "$branch"
  base="origin/$branch"
else
  base="HEAD"
fi

git worktree add --detach "$worktree" "$base" >/dev/null
rm -rf "$worktree/public/api/v1"
mkdir -p "$worktree/public/api/v1"
cp -a "$source_dir/." "$worktree/public/api/v1/"

node - "$worktree/public/api/v1/connector-meta.json" "$source_sha" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [output, sourceRevision] = process.argv.slice(2);
const index = JSON.parse(fs.readFileSync(path.join(path.dirname(output), "index.json"), "utf8"));
const value = {
  schemaVersion: 1,
  privacy: "public-safe",
  kind: "connector-read-cache",
  sourceRevision,
  sourceGeneratedAt: typeof index.generatedAt === "string" ? index.generatedAt : null,
};
fs.writeFileSync(output, JSON.stringify(value, null, 2) + "\n");
NODE

git -C "$worktree" config user.name "github-actions[bot]"
git -C "$worktree" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git -C "$worktree" add -A public/api/v1

if git -C "$worktree" diff --cached --quiet; then
  echo "read-cache unchanged"
  exit 0
fi

git -C "$worktree" commit -m "cache: publish validated API snapshot for $source_sha" >/dev/null
git -C "$worktree" push origin "HEAD:refs/heads/$branch"
echo "Published connector-readable API snapshot to $branch"
