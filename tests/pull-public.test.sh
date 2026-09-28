#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../scripts/pull-public.sh
source "$root/scripts/pull-public.sh"

refuse_embedded_credentials "https://github.com/kvnloo/gh-contrib-archive.git"
if refuse_embedded_credentials "https://x-access-token:gho_secret@github.com/kvnloo/gh-contrib-archive.git"; then
  echo "embedded token URL was accepted" >&2
  exit 1
fi
if refuse_embedded_credentials "https://gho_secret@github.com/kvnloo/gh-contrib-archive.git"; then
  echo "token user URL was accepted" >&2
  exit 1
fi
echo "pull-public credential refusal ok"
