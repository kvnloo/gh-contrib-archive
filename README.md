# GitHub contribution archive

Public-safe visualization and read API for [**@kvnloo**](https://github.com/kvnloo) GitHub activity. Repo: [github.com/kvnloo/gh-contrib-archive](https://github.com/kvnloo/gh-contrib-archive).

Five graph worlds (keys 1–5): `/worlds`. Ledger: `/`.

This tree follows the [Verified OSS Loop](https://github.com/kvnloo/verified-oss-loop). GitHub Pages serves the static app and versioned, read-only JSON API. The default `main` branch owns production publishing and the hourly public attention refresh.

## Privacy

- Public repositories may expose projected links, metadata, and short excerpts.
- Private/unknown repository identities fail closed at the API boundary.
- Raw notification, review, and comment bodies are never published by the attention API.
- GitHub credentials are never written into generated output.
- `data/github.db` is local/private; `data/public.db` is the committed public-safe archive source.
- `data/attention.db` is local and gitignored.

## Local copy

The repository is public. Download or update it without a token:

```bash
scripts/pull-public.sh /path/to/gh-contrib-archive
```

That fetches the public HTTPS URL with `GH_TOKEN` and `GH_ARCHIVE_TOKEN` removed, disables the credential helper for the checkout, and checks `data/public.db` against the git blob.

## Run

```bash
export GH_TOKEN=...          # local archive ingestion only
npm install
npm run ingest
npm run dev                  # http://127.0.0.1:43147
```

## Public read API

GitHub Pages is a materialized, public-safe read model:

```text
GitHub public REST + optional notification credential
  -> sanitizer/projector
  -> validated static JSON
  -> Pages + connector-readable read-cache
  -> readers/agents
```

Key v1 resources include `index.json`, `bootstrap.json`, `attention.json`, `queues.json`, `recent.json`, repository/thread context shards, actor context, revisions, and optional semantic projections.

These are deliberately projected schemas, not arbitrary GitHub API passthrough.

### ChatGPT / connector reads

The validated API snapshot is mirrored after every successful refresh to the `read-cache` branch under `public/api/v1/`. Connector consumers should read `public/api/v1/bootstrap.json` at ref `read-cache`, then follow revision-bearing repo/thread pointers. `public/api/v1/connector-meta.json` binds the snapshot to the exact source commit and source generation time.

The mirror copies JSON from `out/api/v1` only. It does not publish the private database, tokens, arbitrary build output, or raw feedback bodies.

## Freshness

The production workflow lives on the default `main` branch and runs:
- on pushes to `main`
- hourly at minute 17
- on manual dispatch

Each run refreshes the public attention hotset, optionally enriches it using `GH_INBOX_TOKEN`, runs tests/build/API dogfood/evals, publishes the validated connector cache, and then deploys Pages. The incremental archive sync remains a separate daily workflow that updates committed `data/public.db`.

Readers must inspect `connector-meta.json` plus API freshness/coverage metadata rather than assuming an old snapshot is current.

## Contribution attention inbox

Locally:

```bash
gh auth login
gh auth refresh --hostname github.com --scopes notifications
npm run inbox
```

Priority semantics:
- `P0`: fresh human feedback, requested changes, or requested verification/evidence
- `P1`: failing CI, merge conflicts/behind branches, approvals ready for finalization, direct mentions
- `P2`: waiting/review state

For machine consumption:

```bash
npm run inbox:next -- --json
```
