# GitHub contribution archive

Public-safe visualization and read API for [**@kvnloo**](https://github.com/kvnloo) GitHub activity. Repo: [github.com/kvnloo/gh-contrib-archive](https://github.com/kvnloo/gh-contrib-archive).

Five graph worlds (keys 1–5): `/worlds`. Ledger: `/`.

This tree follows the [Verified OSS Loop](https://github.com/kvnloo/verified-oss-loop). CI is GitHub Actions (`npm test` + `npm run build`). GitHub Pages serves the static app **and** a versioned, read-only JSON API.

## Privacy

The website/API is public-safe:

- **Public** repos: links and short excerpts (not diffs).
- **Private** repos: archive rows may exist only as identity-free type/date placeholders.
- **Private commits**: yearly totals only.
- **Attention API**: only PRs whose repository visibility was freshly resolved as `public` are eligible.
- Unknown/inaccessible repository visibility fails closed and is omitted.
- Raw notification, review, and comment bodies are never published.
- GitHub credentials are never written into generated output.

`data/github.db` is the local full archive (gitignored). `data/public.db` is the public-safe archive source. `data/attention.db` is the local contribution attention queue and is also gitignored.

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
GitHub -> credentialed collector -> sanitizer/projector -> static Pages JSON -> readers
```

Initial v1 endpoints:

- `/gh-contrib-archive/api/v1/index.json` — schema, freshness, endpoint catalog
- `/gh-contrib-archive/api/v1/attention.json` — prioritized authored-open-PR queue
- `/gh-contrib-archive/api/v1/contributions.json` — public-safe contribution archive
- `/gh-contrib-archive/api/v1/repos.json` — public repository index
- `/gh-contrib-archive/api/v1/repos/<owner>/<repo>.json` — one repo's cached contribution state
- `/gh-contrib-archive/api/v1/threads/<owner>/<repo>/<number>.json` — one issue/PR thread shard

These are deliberately projected schemas, **not** arbitrary GitHub API passthrough. New GitHub data families should get explicit public schemas before being exposed.

## Contribution attention inbox

Locally, GitHub CLI owns the credential:

```bash
gh auth login
gh auth refresh --hostname github.com --scopes notifications
npm run inbox
```

`npm run inbox:sync` reads participating notifications and reconciles them against all authored open PRs. The classifier prioritizes unfinished existing work before speculative new work:

- `P0`: fresh human feedback, requested changes, or requested verification/evidence
- `P1`: failing CI, merge conflicts/behind branches, approvals ready for finalization, direct mentions
- `P2`: authored open PRs waiting for review

For machine/agent consumption:

```bash
npm run inbox:next -- --json
```

## Hourly Pages refresh

The Pages workflow refreshes hourly and on demand. To include live attention state, configure a **classic GitHub token with only the `notifications` scope** as the repository Actions secret `GH_INBOX_TOKEN`.

Do this from your own terminal; never paste the token into chat:

```bash
gh secret set GH_INBOX_TOKEN --repo kvnloo/gh-contrib-archive
```

Paste the token into the secure CLI prompt. The workflow provides it to `gh` only for the collection step. It is not persisted in SQLite, repository files, artifacts, or Pages output.
