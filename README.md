# GitHub contribution archive

Public-safe visualization of [**@kvnloo**](https://github.com/kvnloo) GitHub history. Repo: [github.com/kvnloo/gh-contrib-archive](https://github.com/kvnloo/gh-contrib-archive).

Five graph worlds (keys 1–5): `/worlds`. Ledger: `/`.

This tree follows the [Verified OSS Loop](https://github.com/kvnloo/verified-oss-loop). CI is GitHub Actions (`npm test` + `npm run build`). There is **no GitHub Pages site** yet — Next.js here is not a static export.

## Privacy

The website is public-safe:

- **Public** repos: links and short excerpts (not diffs).
- **Private** repos: the row exists (type + date) with no title, message, repo name, SHA, or URL.
- **Private commits**: yearly totals only. Public commits link to GitHub’s `commits?author=` list, not to patches.

`data/github.db` is the local full archive (gitignored). `data/public.db` is what the site reads and what this repo ships.

The contribution attention queue is also local-only: `data/attention.db` is gitignored and stores normalized PR state such as priority, blocker, and next action. It does **not** persist notification/comment bodies or GitHub credentials.

## Run

```bash
export GH_TOKEN=...          # needs repo read to classify private vs public
npm install
npm run ingest               # pull + classify + write public.db
npm run dev                  # http://127.0.0.1:43147
```

## Contribution attention inbox

Use GitHub CLI's credential store rather than putting a PAT in this repository:

```bash
gh auth login
gh auth refresh --hostname github.com --scopes notifications
npm run inbox
```

`npm run inbox:sync` reads participating GitHub notifications and reconciles them against **all authored open PRs**, so a read/missed notification cannot silently remove a PR from the queue. The classifier prioritizes unfinished existing work before speculative new work:

- `P0`: fresh human feedback, requested changes, or requested verification/evidence
- `P1`: failing CI, merge conflicts/behind branches, approvals ready for finalization, direct mentions
- `P2`: authored open PRs waiting for review

The normalized queue is printed with `npm run inbox:next`. For machine/agent consumption:

```bash
npm run inbox:next -- --json
```

If notification access is missing, `inbox:sync` prints the exact `gh auth refresh` command required. No PAT is accepted by the script, written to SQLite, or exported to the public snapshot.
