#!/usr/bin/env bash
# Download or update the public archive without a token.
# data/github.db is not in git and cannot be downloaded.
set -euo pipefail

PUBLIC_URL="https://github.com/kvnloo/gh-contrib-archive.git"
BRANCH="main"

refuse_embedded_credentials() {
  local url="$1"
  if [[ "$url" =~ (ghp_|gho_|ghu_|ghs_|github_pat_|x-access-token|://[^/@[:space:]]+:[^/@[:space:]]+@) ]]; then
    echo "refusing a git URL with embedded credentials" >&2
    return 1
  fi
}

git_public() {
  env -u GH_TOKEN -u GH_ARCHIVE_TOKEN -u GITHUB_TOKEN -u GH_ENTERPRISE_TOKEN \
    git -c credential.helper= -c "http.extraHeader=" "$@"
}

pull_public() {
  local dest="${1:-}"
  if [[ -z "$dest" ]]; then
    if git rev-parse --show-toplevel >/dev/null 2>&1; then
      dest="$(git rev-parse --show-toplevel)"
    else
      echo "usage: pull-public.sh /path/to/gh-contrib-archive" >&2
      return 1
    fi
  fi

  if [[ ! -e "$dest/.git" ]]; then
    mkdir -p "$(dirname "$dest")"
    git_public clone --depth 1 --branch "$BRANCH" "$PUBLIC_URL" "$dest"
    git -C "$dest" config --local credential.helper ""
    git -C "$dest" config --local http.extraHeader ""
  else
    local url
    url="$(git -C "$dest" remote get-url origin)"
    refuse_embedded_credentials "$url"
    case "$url" in
      https://github.com/kvnloo/gh-contrib-archive.git|https://github.com/kvnloo/gh-contrib-archive|git@github.com:kvnloo/gh-contrib-archive.git|ssh://git@github.com/kvnloo/gh-contrib-archive.git)
        ;;
      *)
        echo "refusing unexpected origin: $url" >&2
        return 1
        ;;
    esac
    if [[ -n "$(git -C "$dest" status --porcelain --untracked-files=no)" ]]; then
      echo "refusing to update a checkout with local changes" >&2
      return 1
    fi
    git_public -C "$dest" fetch --depth 1 "$PUBLIC_URL" "+${BRANCH}:refs/remotes/origin/${BRANCH}"
    git_public -C "$dest" checkout -B "$BRANCH" "origin/$BRANCH"
  fi

  local db blob local_hash
  db="$dest/data/public.db"
  blob="$(git -C "$dest" rev-parse "HEAD:data/public.db")"
  local_hash="$(git -C "$dest" hash-object "$db")"
  if [[ "$blob" != "$local_hash" ]]; then
    echo "public.db hash mismatch: git $blob file $local_hash" >&2
    return 1
  fi

  node --input-type=module -e '
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[1], { readOnly: true });
const row = db.prepare("SELECT MAX(COALESCE(updated_at, created_at)) AS mark, COUNT(*) AS n FROM contributions").get();
const meta = db.prepare("SELECT value FROM meta WHERE key = ?").get("privacy");
if (!meta || meta.value !== "public-safe") {
  throw new Error("database is not marked public-safe");
}
console.log(`public.db ${row.n} rows, high-water ${row.mark}, privacy ${meta.value}`);
' "$db"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  pull_public "${1:-}"
fi
