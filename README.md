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

## Run

```bash
export GH_TOKEN=...          # needs repo read to classify private vs public
npm install
npm run ingest               # pull + classify + write public.db
npm run dev                  # http://127.0.0.1:43147
```
