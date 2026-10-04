# GitHub contribution archive

Public-safe visualization and read API for [**@kvnloo**](https://github.com/kvnloo) GitHub activity. Repo: [github.com/kvnloo/gh-contrib-archive](https://github.com/kvnloo/gh-contrib-archive).

Five graph worlds (keys 1–5): `/worlds`. Ledger: `/`.

This tree follows the [Verified OSS Loop](https://github.com/kvnloo/verified-oss-loop). CI is GitHub Actions (`npm test` + `npm run build`). GitHub Pages serves the static app **and** a versioned, read-only JSON API.

## Privacy

The website/API is public-safe:

- **Public** repos: links and short excerpts (not diffs).
- **Private** repos: archive rows may exist only as identity-free type/date placeholders.
- **Private commits**: yearly totals only.
- **Attention API**: only PRs classified as belonging to public repositories are eligible.
- Unknown/inaccessible repository visibility fails closed and is omitted.
- Raw notification, review, and comment bodies are never published.
- GitHub credentials are never written into generated output.

`data/github.db` is the local full archive (gitignored). `data/public.db` is the public-safe archive source. `data/attention.db` is the local contribution attention queue and is also gitignored. The private database is not stored on GitHub and cannot be downloaded.

## Local copy

Download or update the public repository without a token:

```bash
scripts/pull-public.sh /path/to/gh-contrib-archive
```

That fetches the public HTTPS URL with `GH_TOKEN` and `GH_ARCHIVE_TOKEN` removed, disables the credential helper for the checkout, and checks `data/public.db` against the git blob. Do not put a token in the remote URL. Civ reads the sibling checkout at `../gh-contrib-archive/data/public.db`.

## Run

```bash
export GH_TOKEN=...          # local archive ingestion only
npm install
npm run ingest
npm run dev                  # http://127.0.0.1:43147
```

## Public read API

GitHub Pages is a materialized read model of relevant GitHub state:

```text
GitHub public REST + optional notification credential -> sanitizer/projector -> static Pages JSON -> readers
```

Start with `/gh-contrib-archive/api/v1/bootstrap.json` for bounded next actions and revisioned thread pointers. `/api/v1/index.json` under the same project prefix catalogs the other resources:

- `attention.json` and `queues.json` — cached authored-PR work state
- `recent.json` — cached thread activity
- `contributions.json` and `repos.json` — public-safe archive and repository index
- `repos/<owner>/<repo>.json` and `threads/<owner>/<repo>/<number>.json` — scoped context
- `actors.json` and `actors/<login>.json` — body-free public interaction metadata
- `changes.json` — content revisions; semantic enrichment remains optional/manual-only

These are projected snapshots, **not** arbitrary GitHub API passthrough or an on-demand refresh service. Inspect source timestamps and coverage before treating a missing row as no work. Reading a static JSON file does not refresh GitHub, and the committed source-tree JSON is not the deployed snapshot.

## Contribution attention inbox

Locally, GitHub CLI owns the credential:

```bash
gh auth login
gh auth refresh --hostname github.com --scopes notifications
npm run inbox
```

`npm run inbox:sync` reads participating notifications and reconciles them against authored open PRs. The classifier prioritizes unfinished existing work:

- `P0`: actionable human feedback, requested changes, or requested verification/evidence
- `P1`: failing CI, merge conflicts/behind branches, approvals ready for finalization, direct mentions
- `P2`: authored open PRs waiting for review

For machine/agent consumption:

```bash
npm run inbox:next -- --json
```

## Refresh and release ownership

`main` is the default branch and sole production Pages publisher. The deploy workflow lives on `main` and refreshes attention on main pushes, explicit workflow dispatch, and the hourly schedule at minute 17. GitHub schedules are best-effort, not a freshness SLA. `preview` and `nightly` remain integration channels; their reusable-workflow calls cannot overwrite the production site.

The public collector needs no secret: it queries the 100 most recently updated public open PRs authored by `kvnloo`, and deep-inspects at most 24 comment-active threads with bounded concurrency and versioned cache reuse. This is a bounded subset, not a complete GitHub mirror. Tests, build, API dogfood, and aggregate evals must pass before publication.

The separate daily `Sync public archive` workflow preserves incremental archive ingestion using `GH_ARCHIVE_TOKEN`. It explicitly calls the production deploy workflow after a successful sync, because a bot-token commit alone does not trigger another push workflow. The build reads the current main archive and records its actual checkout SHA in `release.json` and eval provenance. No data is marked fresh merely because deployment succeeded.

A classic token with the `notifications` scope is optional attention enrichment. Store it from your own terminal:

```bash
gh secret set GH_INBOX_TOKEN --repo kvnloo/gh-contrib-archive
```

The optional secret is supplied only to the collection step. It is not persisted in SQLite, repository files, artifacts, or Pages output.
