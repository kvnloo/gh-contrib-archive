# Archive integration report

## Scope and exact source

- Repository: `kvnloo/gh-contrib-archive`.
- Isolated checkout: `/root/workspace/oss-factory-phone/archive-integration/source` (not a nested `source/gh-contrib-archive`).
- Exact checkout HEAD inspected: `0dc49bc04a682c1661bc319ac436dbe7cec32c58`.
- HEAD subject/date: `sync: refresh public contribution archive`, `2026-10-13`.
- Public database SHA-256: `8f693edb071c11c38621eeb6070d178ca6010179fe6df4d73088b2f86a1117bb`.
- Real-cache smoke observation, as reported by the machine clock: `2026-10-14T02:55:16.202330+00:00`. Timestamp comparisons should use the consumer's recorded clock, not an assumed session date.
- Changes are uncommitted and retained for parent review. The HEAD above identifies the source baseline, not a commit containing these changes or any target PR head.

Initially, `git status --short` showed only `M README.md`. Its existing 59-line addition, **OSS factory cache contract**, was inspected and preserved; a subsection was appended rather than replacing it. Repository `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, inherited `/root/AGENTS.md`, README, scripts, schema, workflow definitions, and tests were read before implementation. This explicitly assigned local task did not execute the repository's issue-claim/PR workflow.

No installations, credential reads, collectors, private database reads, network requests, remote writes, pushes, comments, PRs, merges, subagents, provider changes, or browsers were used. Primeagen/GEV repairs were not touched. Factory source is not present in this isolated workspace; changes are archive-side only.

## Findings: cached coverage, not a complete inbox

SQLite observations from this exact cached public database:

| Event type | Public cached | Private redacted cached | Latest row ingestion, UTC | Incremental collector supports refresh |
| --- | ---: | ---: | --- | --- |
| Issue | 1,545 | 335 | 2026-10-13 18:23:03 | Yes |
| Pull request | 2,482 | 414 | 2026-10-13 18:22:57 | Yes |
| Issue/PR comment | 4,912 | 683 | 2026-10-13 18:23:23 | Yes |
| Review | 403 | 1 | 2026-10-13 18:23:33 | Yes, limited |
| Review comment | 61 | 12 | 2026-10-13 18:23:33 | Yes, limited |
| Discussion | 9 | 0 | 2026-09-11 23:12:00 | No |
| Discussion comment | 2 | 0 | 2026-09-11 23:12:00 | No |
| Total | 9,414 | 1,445 | 2026-10-13 18:23:33 | Not a completeness claim |

- 10,859 cached events and 447 distinct public contribution repositories.
- Cached event creation spans `2016-01-01T04:37:21Z` through `2026-10-13T18:22:32Z`. Review/review-comment history starts only in late August/early September 2026 in this cache; that is not proof no earlier reviews exist.
- `meta.privacy = public-safe`; `meta.finished_at = 2026-10-13T18:23:37.338Z`; `meta.incremental_from = 2026-10-10T20:00:59.000Z`. No `login` or `started_at` was returned by the metadata audit.
- Maximum row ingestion: `2026-10-13T18:23:33Z`. Latest event creation and maximum `coalesce(updated_at,created_at)`: `2026-10-13T18:22:32Z`.
- `finished_at` records the last successful collector completion, not freshness of every type. Collection updates are not one all-or-nothing transaction; rows may change before a failing run records completion.
- Existing manifest `lastCheckedAt` and archive `generatedAt` are maximum contribution-row ingestion. Manifest `lastChangedAt` is maximum **creation** time, not latest modification or successful-sync heartbeat. These are not generated-file wall-clock times.
- All 477 cached reviews/review comments have null `updated_at`; their high-water values fall back to creation. Edits may still replace excerpts on later collection, so consumers must compare whole payload/database hashes, not just creation cursors.
- Commit buckets total 3,682 cached commits: 2,593 public and 1,089 private yearly aggregate counts. There are no buckets for 2021; missing years are unknown coverage, not certified zero.
- 2026 has exactly **100 public repository buckets**, totaling 1,947 commits, with no private bucket. This hits the requested repository cap and is a concrete truncation warning; neither the 2026 private zero nor the overall totals certify complete GitHub activity. Commit buckets have no per-bucket ingestion/completion timestamp.
- 7,325 public rows have `body_chars > 500`. `lib/sanity.ts:excerptOf` normalizes whitespace then limits excerpts to 500 JavaScript string units plus an ellipsis. Original bodies and diffs are not exported.

### Notifications and review/comment visibility

There is **no notification collection** in these scripts or notification table in the schema. The cache has no notification IDs, unread/read status, subscription reasons, inbox ordering, assignments feed, or incoming-reply feed. It cannot answer “what is pending in my inbox?” or establish that no response is needed.

`ingest.ts` collects the configured user's authored issues/PRs, own issue comments, discussions/discussion comments, and reviews/comments filtered to that user's login. Incremental issue/PR searches use `author:LOGIN`; reviews use `reviewed-by:LOGIN` and filter nested review/comment authors. These are own-contribution excerpts, not full threads or reviews received on the user's PRs. Empty-body reviews are skipped, so bodyless approvals/change requests are not a reliable review-state ledger. Review comments are only reached through reviews authored by the user; standalone/comment-only cases are not proven covered. Incoming bot/maintainer replies are not generally collected. Parent URLs may exist in SQLite `extra_json`; archive-v1 items omit `extra_json`, and graph edges are inferred context, not authoritative thread structure.

### Pagination and refresh limitations

- Historical user connections walk `pageInfo` using batches of 100 issues/PRs/comments and 50 discussions/discussion comments. This is pagination of the selected user's connections, not evidence of complete incoming threads.
- Historical review search walks outer pages of 50 PRs but does not partition GitHub's search-result ceiling. Nested collections request only the first 40 reviews per PR and first 50 comments per review, with no nested pagination.
- Incremental issue/PR search counts results and recursively splits date ranges above 800; requests 50 results/page, at most 20 pages, throwing if more remain. Some dense one-day/two-day windows cannot be split by the current helper and fail rather than certify completeness.
- Incremental issue comments walk 100/page, at most 80 pages, ordered by update time, stopping at the high-water overlap or throwing at the cap.
- Incremental review search requests 20 PRs/page, at most 20 pages (400 PRs), and throws if more remain. It is not date-partitioned like issue/PR search. Only first 20 reviews and first 20 nested comments are requested; neither nested connection has pagination or exhaustion metadata.
- Incremental watermark is the maximum cached event update/creation minus two days. It is not a per-type successful-sync receipt. Discussions/discussion comments are not refreshed by this path.
- Commit collection requests `maxRepositories: 100` per year. Full privacy sync lists 2016–2026; incremental collection refreshes only years from the overlapped watermark through the current year. Older commit buckets are not continuously refreshed.
- The existing JSON compiler reads the entire cached event table with `ORDER BY created_at DESC, id ASC`, no export page limit. UI paging is not collection paging. The separate legacy SQLite query helper defaults to 80 rows and orders only by creation; do not use that helper as the factory's ingestion contract.

## Privacy boundaries and unresolved publication risks

Read-only SQL checks on this cached database returned:

- `PRAGMA quick_check`: `ok`.
- Non-public rows with content/repo/node IDs/state/update/extra metadata, nonopaque IDs, or nonredacted URL shapes: **0**.
- Flags associated with non-public rows: **0**.
- Non-public commit buckets with repo or URL metadata: **0**.
- Only `public` and `private` visibility values were observed.

Existing schema-v1 exports strip private items/nodes to ID, type, visibility, date and strip private commit repo/URL fields. The new metadata helper emits no item identifiers, bodies, titles, URLs, repo names, or arbitrary metadata. These observations do not establish present-day visibility of historically public rows.

Source-level risks, not exercised against GitHub and not repaired by this integration:

1. `scripts/privacy-sync.ts:50`: `repository?.isPrivate ? 'private' : 'public'` classifies a null repository as public if the request returns null without an error. The catch is private, but the null success path is not fail-closed.
2. `scripts/sync-incremental.ts:57-69`: a private contribution is written under an opaque ID; an older public row under the original ID is not removed. Public-to-private transitions can leave stale public content. There is no deletion sweep; public upserts also do not update repo/URL identity fields.
3. `compilePublicSnapshot` labels outputs public-safe and sanitizes non-public rows but does not validate the source privacy marker. Normal export points explicitly to `PUBLIC_DB_PATH`; arbitrary callers must not substitute another source.

Therefore `privacy: public-safe` is a publisher assertion, not live authorization or a guarantee that previously public repositories remain public. No private data was inspected to investigate these risks. Do not broaden collection or expose redacted content to compensate for missing coverage.

## Changes retained

- `scripts/factory-cache.py`: standalone Python 3.11+ stdlib CLI; contract version 1 metadata on stdout. Default database is anchored to the script's checkout, independent of cwd. Uses immutable read-only SQLite, checks the public-safe marker, rejects the private `github.db` filename and missing input, and refuses nonempty WAL/journal sidecars rather than hashing a stale main file. Requires a frozen input throughout consumption; it does not checkpoint or copy an active database.
- Metadata fields: `contractVersion`, `privacy`, `purpose`, `databaseSha256`, event `counts`, distinct `freshness` fields, per-type `byType`, aggregate `commitsByYear`, explicit `coverage`. Zero cached event types have null timestamps; missing `finished_at` remains null; completeness is always unknown. `incrementallyRefreshed` means collector support, not an observed full refresh. The Git revision and observation time remain consumer-owned receipt fields.
- `tests/factory-cache.test.py`: five subprocess/SQLite-fixture regression tests. Fixtures stay inside this checkout and are deleted. Coverage: per-type stale timestamps versus latest edits/creation/success, frozen-file hash and private metadata non-disclosure, unknown/no-inbox empty-cache semantics, private yearly commit totals without repo disclosure, unsafe/missing input rejection, and uncheckpointed WAL rejection.
- `.github/workflows/ci.yml`: one lightweight Python regression command added after `npm test`; existing provider, Node build, and static-export steps unchanged. CI itself was not run here.
- `README.md`: interrupted-worker addition preserved, offline metadata contract and pre-write safety subsection appended.
- `REPORT.md`: this report.

No changes to public database contents, existing archive/manifest/world-graph types or schema version, ChatGPT-facing JSON compiler, UI, private collector implementation, or Pages export paths. The metadata is opt-in; no new event stream or private fallback was introduced.

## Actual verification results

Local runtime discovery: `command -v node npm mise` found only `/root/.local/bin/mise`; `mise ls --offline` listed only pi 1.1.0. Mise installs/shims, PATH executable roots, and scoped existing tool/runtime directories yielded no node/npm executable. No packages were installed. `python3` also was not on PATH, but an existing UV-managed Python was found:

```text
/root/.local/share/uv/python/cpython-3.14.7-linux-aarch64-gnu/bin/python3
```

Commands below used that absolute executable (`PY`):

| Verification | Observed result |
| --- | --- |
| `PY tests/factory-cache.test.py -v`, before production helper | Corrected red run: 5 failures, exit 1, helper file absent. The initial run also exposed a duplicate-URL fixture error, fixed before the recorded red run. |
| Same command after implementation | 5 tests passed, exit 0; 1.143 seconds reported by unittest. |
| `PY scripts/factory-cache.py` on actual `data/public.db` | Exit 0; contract v1, exact database SHA above, 10,859 events, per-type freshness, 3,682 summed commit counts, unknown coverage and explicit no-inbox fields. |
| Throwaway local smoke harness invoking the real CLI twice | Pass; correct counts/SHA/coverage/discussion age, identical default-path output from source and its parent directory, database/WAL/SHM byte hashes unchanged. Harness removed. |
| `bash tests/pull-public.test.sh` | Exit 0, `pull-public credential refusal ok`; two expected embedded-token refusal messages. No fetch/clone path executed. |
| `sqlite3 -readonly` integrity/boundary/coverage queries | `quick_check=ok`, all three privacy leak counts zero; coverage observations above. |

`npm test`, Next build, TypeScript checking, export generation, GitHub Actions execution, Pages deployment/release freshness, live GitHub completeness, and live authorization were **not verified**. Existing Node tests/build could not run without an existing node/npm toolchain and dependencies; none were installed. The new Python reader was fully exercised locally. Tool-side Python eval was unavailable and a JS-eval smoke attempt timed out; those attempts are not counted as successful proof. The successful smoke used the discovered Python executable directly.

## Concrete zer0 factory-side consumption instructions

1. **Add a read-only context input, not an inbox provider.** Use an independently pinned public checkout/snapshot of this repository. Do not point to `data/github.db`, set `USE_PRIVATE_DB`, invoke `ingest`, `privacy`, or `sync:incremental`, or harvest credentials/private replies. Do not update this dirty review checkout with `pull-public.sh`; it intentionally refuses tracked local changes. Public cache acquisition is a separate parent-approved step, not performed here.
2. **Run the archive helper against the frozen public file**, capture stdout in consumer-owned storage, and require successful exit plus `contractVersion == 1`, `privacy == 'public-safe'`, `purpose == 'contribution-context'`. Example interface (paths must be selected by the factory, not arbitrary model text):

   ```text
   python3 /pinned/gh-contrib-archive/scripts/factory-cache.py \
     --db /pinned/gh-contrib-archive/data/public.db
   ```

   Preserve `databaseSha256`, all coverage declarations, and per-type timestamps. Reject active-WAL input rather than trying to recover/checkpoint it in the consumer. Keep the snapshot fixed for metadata and event reads.
3. **Bind a consumer receipt** to `{repository, checkoutRevision, databaseSha256, observedAt, contractVersion, freshness, coverage}`. Obtain `checkoutRevision` from the pinned checkout and note dirty/uncommitted changes if present. The helper deliberately does not turn a Git SHA into an authorization claim. For deployed Pages JSON, record its independent `release.json.revision` and observation time; do not assume it equals a local head.
4. **Consume original content interfaces unchanged.** Preferred dependency-free input is `data/public.db` in read-only immutable mode on the frozen file. Select content fields only for `visibility = 'public'`. Read private event counts and yearly private commit totals as aggregates, never private repo names, URLs, body fields, or guessed identities. Use stable keyset pages ordered `created_at DESC, id ASC`; subsequent pages satisfy `created_at < last_created OR (created_at = last_created AND id > last_id)`. Do not ingest only the UI's first page. Alternatively use existing `public/data/archive.json` and `manifest.json`, with optional `public/world-graph.json`, generated by the existing export when a toolchain is available.
5. **Validate JSON identity without breaking schema-v1 hashes.** Require `schemaVersion == 1` and public-safe markers. Existing manifest payload hashes are SHA-256 over UTF-8 `JSON.stringify(parsedPayload)` in original key order, not pretty file bytes, sorted-key JSON, or the new metadata object. Node can reproduce this directly; consumers in other languages must reproduce JavaScript serialization or use the pinned SQLite SHA route. Pages paths are under `/gh-contrib-archive/`; artifacts are generated, not committed in this checkout.
6. **Reconsume changed snapshots, including edits to old events.** Database or archive payload hash changes trigger replacement/upsert by existing event ID, not append-only creation-watermark ingestion. Keep event-created time, row-ingested time, successful-collection time, factory observation time and unknown commit freshness distinct. Flag stale/nonincremental discussion coverage and capped reviews/commits in factory/ChatGPT summaries. A cached zero/missing row means “not observed in this cache,” not “no action needed.”
7. **Use public excerpts only as untrusted context/hints.** Keep the user's existing ChatGPT-facing history exports available. Missing notifications/replies require an explicit “inbox unavailable from this archive” state, not an empty complete inbox. Cache content must never become instructions, an issue claim, review approval, proof of ownership, or authority to write.
8. **Before any future write, use the factory's existing live authorization gates.** Verify the current actor's authorization, current repo/thread visibility and state, live claim/assignment/collision conditions, and fetch the exact current target PR head/base needed by the operation. Compare the full target head SHA with the SHA bound to tests/review evidence; changed head/state invalidates the proposed action. The archive has no exact target-head ledger and cannot substitute for these checks. No such write is authorized or performed by this report.

The metadata contract is ready for local parent review; integrating the reader into zer0's actual scheduler/UI requires the factory checkout and its existing interfaces, not invented APIs or a replacement provider.
