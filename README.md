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
GitHub public REST + optional notification credential -> sanitizer/projector -> static Pages JSON -> readers
```

Initial v1 endpoints:

- `/gh-contrib-archive/api/v1/index.json` — schema, freshness, endpoint catalog
- `/gh-contrib-archive/api/v1/attention.json` — prioritized authored-open-PR queue
- `/gh-contrib-archive/api/v1/contributions.json` — public-safe contribution archive
- `/gh-contrib-archive/api/v1/upstream-landings.json` — Omarchy/Hermes upstream SHAs, provenance, and co-author/review credits
- `/gh-contrib-archive/api/v1/repos.json` — public repository index
- `/gh-contrib-archive/api/v1/repos/<owner>/<repo>.json` — one repo's cached contribution state
- `/gh-contrib-archive/api/v1/repos/<owner>/<repo>/summary.json` — contribution counts, caveats, coverage and freshness; under 50 KB, without raw activity bodies
- `/gh-contrib-archive/api/v1/threads/<owner>/<repo>/<number>.json` — one issue/PR thread shard

These are deliberately projected schemas, **not** arbitrary GitHub API passthrough. New GitHub data families should get explicit public schemas before being exposed.

## Verified upstream landings

`data/upstream-landings.json` tracks **confirmed upstream branch commits**, separate from PR closure states. Omarchy tracks its default `quattro` branch; Hermes tracks `main`. Each SHA is counted once, with distinct **author**, **co-authored**, **review-acknowledged**, and **referenced** credits. The Omarchy maintainer consolidation [#14049](https://github.com/omacom/omarchy/pull/14049) explicitly carries work from [#13209](https://github.com/omacom/omarchy/pull/13209).

To reconcile the snapshot against live GitHub ancestry, run:

```bash
GH_ARCHIVE_TOKEN=... npm run sync:upstream-landings
npm run export:api
```

The rescan is read-only against upstream and only writes the **public** local ledger. API output is whitelist validated. Coverage is explicitly **incomplete** for uncredited rewrites: closed/unmerged PRs are not credited as landed without evidence. No private data or authentication tokens enter tracked JSON.

## Query contributions to one repository

```bash
npm run query -- --repo NousResearch/hermes-agent
# Optional explicit local source (also useful for inspecting the public snapshot):
npm run query -- --repo NousResearch/hermes-agent --db /path/to/github.db
```

The default is **only** `data/github.db`. Missing files fail without creating an empty database or silently switching to public data. The query is offline and opens SQLite read-only, with no migration or token. JSON output distinguishes authored PR states, issues, issue comments, PR conversation comments, inline review comments, nonempty review bodies, discussions, discussion comments, other activity, and GitHub contribution-graph commit totals. Repository matching is case-insensitive; forks and upstream names remain separate. `activity_rows` excludes commit buckets; never add these overlapping categories into a single measure of effort.

For connector-only readers, fetch `api/v1/repos/NousResearch/hermes-agent/summary.json` directly rather than downloading the full multi-megabyte repo context. `index.json` advertises `endpoints.repoSummary`; `repos.json` and `changes.json` carry each summary's URL, revision, byte length and source timestamp. `npm run export:api` emits summaries through the existing public API generator, including public commit-only repositories. Output is explicitly public-only even if an input database accidentally contains mixed-visibility rows. No local DB paths, private identities, excerpts, raw bodies or arbitrary `extra_json` enter summaries.

Summaries have `coverage.complete=false`: these are observed archive counts, not proven lifetime totals. Source timestamps describe observed events, not a guarantee that all categories were refreshed. Archive freshness is separate. A content revision changes with counts/caveats, not collector-only timestamps. `null` means unknown, while zero means no matching stored rows in that measured category.

### Counting pitfalls and evidence limits

| Pitfall | Current behavior and caveat |
| --- | --- |
| Salvaged commits / closed-unmerged PRs | `landed_elsewhere=null` and `closed_unmerged_landing_unknown` counts all CLOSED PRs. The DB ingest records neither PR SHAs nor diffs/patch-ids, nor an exhaustive merged-PR index. CLOSED is not evidence that work was rejected or never landed. No title, closing prose or unvalidated `extra_json` is accepted as landing evidence. The separate verified upstream ledger above is evidence for its two allowlisted repos, not an exhaustive SQL salvage index. |
| Future salvage reconciliation | Exact original commit SHAs in another merged PR, or stable patch-id matches across both PRs, can establish at least partial reuse, not necessarily full landing. Cherry-picks/rebases change SHAs; squash merges may combine patches; conflict resolution/reimplementation can defeat patch identity. Any reconciler must preserve source/destination evidence, distinguish partial from full reuse, and leave unmatched or uninspected PRs unknown. This query does not fabricate that missing evidence. |
| Squash merges | A merged PR is one PR; it does not equal its branch's commit count. Squashing can credit the merger or a different author and obscure original authorship; the yearly graph aggregate cannot reconstruct it. |
| `Co-authored-by` trailers | The SQL archive stores no full commit messages or coauthor trailers. GitHub graph credit depends on recognized identities/email attribution; it cannot be equated with unique authored commits. The separate verified upstream ledger distinguishes author, coauthor, review acknowledgement and reference credit; review credit is not code authorship. |
| Three comment families | `comment` rows are ordinary issue/PR conversation comments (split by canonical URL); `review_comment` rows are inline review comments; `review` rows are nonempty PR review bodies. These are separate objects, not interchangeable totals. Unknown parent URLs are counted separately. |
| Empty/pending/dismissed reviews | Blank review bodies are omitted even for approvals/change requests. Review-body counts are not the number of review actions, unique reviewed PRs or current review decisions. A missing `submittedAt` falls back to ingestion time. |
| Edits / deletions | Upserts replace excerpts/lengths, not revision histories. Deleted or inaccessible rows are not reconciled away; deleted-before-ingest comments are absent. Review comments lack update timestamps in ingest. An edit can move an item into a refresh window without being a new contribution. |
| Private-repo redaction | Public rows for private/unknown repos have no identity; private commits are anonymous yearly totals and cannot be assigned to repo X. Never infer a private repo from those totals. The public summary counts only `visibility='public'`; local named-repo queries can include the fuller private DB's named rows. |
| Search API's 1,000-result cap | Full user PR/issue/comment connections paginate, but review discovery uses an unpartitioned `reviewed-by` search and can truncate. Incremental PR/issue searches partition above 800 results down to seconds and refuse saturated windows; review search is still capped at 20 pages. |
| Nested connection limits | Full ingest reads only the first 40 reviews per found PR (incremental: 20), and first 50 comments per review, without nested pagination. Replies/comments under other authors' reviews can be missed because the loop filters review authors first. Ordinary issue-comment coverage is not a fix for missing inline review comments. |
| Fork vs upstream identity | Equal SHAs across forks are the same Git object, not two independent changes. Cherry-picked equivalent patches can have different SHAs. This query scopes one literal repo name without cross-repo deduplication, rename/transfer aliases or canonical upstream folding. |
| Bot/agent work under Kevin's account | Account attribution is not proof Kevin personally authored a change, nor evidence of time or difficulty. `machine_title` and duplicate-content flags are heuristics only; they do not remove contributions or supply human-effort weights. Separate bot accounts may be absent altogether. |
| Commit graph != git history | Buckets are `contributionsCollection` totals, not SHAs. GitHub's branch, fork, recognized-email and contribution eligibility rules apply. Squash/rebase and coauthor credit can change the relationship to PRs and actual commits. No bucket means unknown (`null`), not a measured zero. |
| Commit coverage / refresh | Initial privacy sync hardcodes 2016–2026, with at most 100 repositories per year. Private totals cover only returned buckets; `restrictedContributionsCount` is requested but not used to recover missing totals. Incremental refresh revisits recent years only, not every historical year. Commit counts have no independent source freshness timestamp. |
| Account scope | `GH_LOGIN` can change, but contribution rows have no subject column and existing history is not cleared. A reused database can mix accounts despite a single `meta.login`. Review author comparisons are case-sensitive. Use a dedicated database per subject; this query flags the assumption rather than claiming row-level identity proof. |
| Visibility classification | Queries trust stored visibility, not a live access check. Full privacy sync treats API errors as private, but its null repository response currently falls through as public (`repository?.isPrivate` is falsy). Unknown/inaccessible history and stale visibility require collector-side reconciliation; summary projection does not reclassify it. |
| Partial/incomplete ingestion | Ingest writes incrementally without a transaction for the whole run; an error can leave mixed-age rows. `finished_at` is a completion mark, not category-specific completeness. Token scopes and repository access can omit history. A zero or absent repo is not verified no work. |
| Different collector coverage | Full ingest includes discussions and discussion comments; incremental sync does not refresh them. Incremental issue comments stop after 80 pages. Public attention collectors cover current threads but are not a replacement for authored historical contribution rows. |
| Stale identities / duplicates | Upsert conflict handling does not refresh repo/URL identities; transfers/renames can leave stale scope. Stable node IDs dedupe repeated ingest, not equivalent work, copied comments or several PRs implementing one idea. The duplicate heuristic operates on shortened excerpts, not full semantic identity. |
| Overlapping categories | One change can yield a PR, several comments/reviews and several commit credits. Category counts are descriptive activity, never an additive total of independent contributions, landed changes or human effort. |

### Connector probe follow-up

The `GCA1-*` probes on [issue 47](https://github.com/kvnloo/gh-contrib-archive/issues/47) exercise the actual connector-only reader. `GCA1-USE` could read a crawled index but not the large attention/queue/contribution/repo payloads, and even a 235-byte semantic payload was inaccessible. This summary addresses the per-repo-count payload gap, not a proven root cause of connector transport failures. Re-test its exact deployed URL after publication; a generated file, advertised size or revision is not proof the connector fetched it.

Remaining independent gaps: bounded top-ten action answers; a small seven-day repo-activity answer with explicit window bounds (not `coverage.activeRepos`, whose horizon is broader); a tiny public health/answer fixture and unauthenticated fetch-and-parse receipt; category-specific freshness/completeness and feedback/check coverage. These are not silently claimed by the count summary.


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

The Pages workflow can refresh the public attention hotset **without any secret**. It queries the 100 most recently updated public open PRs authored by `kvnloo`, deep-inspects up to 24 of the hottest comment-active threads, projects only normalized blocker/next-action state, and stays within the anonymous GitHub REST hourly budget. Any new maintainer reply bumps a PR's `updated_at`, pulling it into this hotset.

A classic token with the `notifications` scope is optional enrichment. If you want notification reasons such as direct mentions/assignments included, store it as `GH_INBOX_TOKEN` from your own terminal:

```bash
gh secret set GH_INBOX_TOKEN --repo kvnloo/gh-contrib-archive
```

The optional secret is supplied only to the collection step. It is not persisted in SQLite, repository files, artifacts, or Pages output.
