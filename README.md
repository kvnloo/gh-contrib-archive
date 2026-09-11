# GitHub contribution archive

Visualization of [**@kvnloo**](https://github.com/kvnloo) GitHub history: issues, pull requests, comments, discussions, reviews, and **commit counts**.

## Privacy

The website is public-safe:

- **Public** repos: links and short excerpts (not diffs).
- **Private** repos: the row exists (type + date) with no title, message, repo name, SHA, or URL.
- **Private commits**: yearly totals only. Public commits link to GitHub’s `commits?author=` list, not to patches.

`data/github.db` is the local full archive (gitignored). `data/public.db` is what the site reads and what this repo ships.

## Run

```bash
export GH_TOKEN=...          # needs repo read to classify private vs public
npm install
npm run ingest               # pull + classify + write public.db
npm run dev                  # http://127.0.0.1:43147
```
