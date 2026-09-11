# GitHub contribution archive

SQLite archive of [**@kvnloo**](https://github.com/kvnloo) GitHub history: issues, pull requests, issue/PR comments, discussion posts, reviews, and inline review comments. Records store **links plus a short excerpt** — not patches or file diffs.

## Run

```bash
export GH_TOKEN=...          # GitHub token with read access
npm install
npm run ingest               # newest-first GraphQL pull, then older pages
npm run dev                  # http://127.0.0.1:43147
```

`data/github.db` is the database. Re-run ingest anytime; rows upsert by GraphQL node id.

## Sanity flags

Ingest scores each row for empty bodies, Cursor/Copilot markers, KEEP/CHECK agent templates, generic LLM filler, near-duplicates, and acknowledgement-only comments. Filter them in the UI (`agent_marker`, `generic_ai_slop`, …).
