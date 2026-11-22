# GitHub contribution archive

Public-safe visualization of [**@kvnloo**](https://github.com/kvnloo) GitHub history. Repo: [github.com/kvnloo/gh-contrib-archive](https://github.com/kvnloo/gh-contrib-archive).

Five graph worlds (keys 1–5): `/worlds`. Ledger: `/`.

This tree follows the [Verified OSS Loop](https://github.com/kvnloo/verified-oss-loop). CI is GitHub Actions (`npm test` + `npm run build`). The public site is the static export on GitHub Pages: [kvnloo.github.io/gh-contrib-archive](https://kvnloo.github.io/gh-contrib-archive/). Pushes to `main` publish it.

## Privacy

The website is public-safe:

- **Public** repos: links and short excerpts (not diffs).
- **Private** repos: the row exists (type + date) with no title, message, repo name, SHA, or URL.
- **Private commits**: yearly totals only. Public commits link to GitHub’s `commits?author=` list, not to patches.

`data/github.db` is the local full archive (gitignored). `data/public.db` is what the site reads and what this repo ships. The private database is not stored on GitHub and cannot be downloaded.

## Local copy

The repository is public. Download or update it without a token:

```bash
scripts/pull-public.sh /path/to/gh-contrib-archive
```

That fetches the public HTTPS URL with `GH_TOKEN` and `GH_ARCHIVE_TOKEN` removed, disables the credential helper for the checkout, and checks `data/public.db` against the git blob. Do not put a token in the remote URL. Civ reads the sibling checkout at `../gh-contrib-archive/data/public.db`.

## OSS factory cache contract

Use this archive as contribution history and thread context, **not a live inbox**.
The collectors do not export notifications, unread state, assignments, or incoming
replies as an inbox feed. Public excerpts are whitespace-normalized and truncated
to 500 characters plus an ellipsis; they are not full bodies or diffs.

Consume a pinned checkout's `data/public.db` read-only, or reuse the existing
`npm run export:public` output when Node and dependencies are already available:

| Artifact | Contract |
| --- | --- |
| `public/data/manifest.json` | `PublicSnapshotManifest`, `schemaVersion: 1`, counts and payload hashes |
| `public/data/archive.json` | `PublicArchive`, `schemaVersion: 1`, complete cached item array |
| `public/world-graph.json` | `PublicWorldGraph`, optional graph context |

These JSON files are generated, not committed. Pages serves them beneath
`/gh-contrib-archive/`; its separate `release.json` records the built revision.
Do not assume the deployed revision matches a local checkout.

- Require `privacy: "public-safe"` in SQLite `meta` or the JSON payloads. Never
  substitute `data/github.db`, run collectors, or enable `USE_PRIVATE_DB`.
- For content, select only `visibility = 'public'`. Keep private event counts and
  yearly private commit totals, but never infer private repo names or bodies.
  Private JSON items contain only `id`, `type`, `visibility`, and `created_at`.
- Preserve schema-v1 exports. The manifest hashes SHA-256 of UTF-8
  `JSON.stringify(parsedPayload)` with its existing key order, **not** the
  pretty-printed file bytes or sorted-key JSON.
- Record the checkout revision, SHA-256 of `data/public.db`, and the factory's
  observation time in a consumer-owned receipt. For SQLite, also record
  `meta.finished_at` when present: it is the last recorded successful collection,
  not proof that every contribution type is complete.
- `lastCheckedAt` and archive `generatedAt` are the maximum row `ingested_at`;
  `lastChangedAt` is the latest event **creation**, not the latest edit or a
  successful-sync heartbeat. Treat missing or stale coverage as unknown, not zero.
- Read the entire cached array or paginate a stable SQLite snapshot with
  `ORDER BY created_at DESC, id ASC`. The UI's page size is not a collection limit.
  Reconsume changed payloads by hash; a single creation-time cursor misses edits.

Offline freshness/count inspection (no token, no collection):

```bash
sqlite3 -readonly -header -column data/public.db "
SELECT (SELECT value FROM meta WHERE key='finished_at') AS last_successful_sync,
       strftime('%Y-%m-%dT%H:%M:%SZ',max(ingested_at)) AS last_row_ingested,
       max(created_at) AS latest_event_created,
       max(coalesce(updated_at,created_at)) AS event_high_water
FROM contributions;
SELECT visibility,count(*) AS events FROM contributions GROUP BY visibility;
SELECT year,visibility,sum(commit_count) AS commits
FROM commit_buckets GROUP BY year,visibility ORDER BY year,visibility;"
```

Coverage limits: incremental sync refreshes issues, PRs, issue comments, reviews,
review comments, and recent commit years; it does not refresh discussions or
discussion comments. Nested reviews/comments are capped without nested pagination,
and commit collection requests at most 100 repositories per year. Cache absence is
not evidence of no contribution or no pending action.

### Offline factory metadata (contract v1)

Python 3.11+ can describe the committed cache without Node, npm dependencies,
credentials, or collection:

```bash
python3 scripts/factory-cache.py
python3 tests/factory-cache.test.py -v
```

The first command writes JSON to stdout, not into the checkout. `--db PATH`
selects another **frozen public-safe snapshot**; the default is this script's
checkout `data/public.db`, independent of the current directory. The reader uses
read-only immutable SQLite and refuses missing inputs, the private `github.db`,
missing/non-public-safe privacy markers, and nonempty WAL/journal files. Keep the
input fixed throughout reading; this is not an active-database reader.

`contractVersion: 1` is separate from the unchanged website `schemaVersion: 1`.
The metadata includes `databaseSha256`, event counts, `freshness`, per-type
`byType` counts/timestamps, yearly `commitsByYear` totals, and explicit `coverage`
limits. It emits no item bodies, titles, URLs, IDs, repo names, or arbitrary meta.
Absent event types have zero **cached** events and null timestamps. Missing
`finished_at` stays null. `incrementallyRefreshed` describes collector support,
not proof of a recent or complete refresh; commit buckets have no freshness
timestamp. `coverage.completeness` is always `"unknown"`.

Use the output as consumer-owned metadata alongside the original public
SQLite/JSON exports, not as another event stream. Record the checkout revision
and observation time separately. The privacy marker is a publisher assertion,
not live visibility verification: cached public rows may outlive deletion or
repo visibility changes. Before any factory write, obtain live authorization,
recheck repository/thread state and visibility, and compare the exact current
target head with the head for which evidence was produced. Cache timestamps,
review states, flags, excerpts, and hashes never authorize an action.

## Run

```bash
export GH_TOKEN=...          # needs repo read to classify private vs public
npm install
npm run ingest               # pull + classify + write public.db
npm run dev                  # http://127.0.0.1:43147
```
