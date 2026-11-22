# Factory cache acceptance — local independent review

## Decision and scope

The local Python cache reader passes the complete Python test suite and a real-CLI smoke run after hardening. This is acceptance for offline metadata consumption of a caller-frozen public SQLite snapshot, not factory integration, an inbox, completeness, or live privacy authorization.

Only `scripts/factory-cache.py`, `tests/factory-cache.test.py`, and this report were changed by this review. All five original tests remain unchanged; 14 regression/boundary tests were added. Existing `ROOT`, `EVENT_TYPES`, `INCREMENTAL_TYPES`, `iso_time`, `summarize`, `main`, CLI arguments, contract version, and report field names remain available. No collector TypeScript, database contents, schema SQL, workflows, existing public content exports, or other checkout was edited.

Original rules were read explicitly from `AGENTS.md`, `CONTRIBUTING.md`, and `SECURITY.md`; `REPORT.md` and the orientation/TDD/anti-slop skill files were also read. The assigned local-only constraints supersede the repository's remote claim/PR workflow for this task: no fetch, issue search/claim, API calls, push, PR, comments, or merges were performed. No installs, credentials, subagents, browsers, provider fallback, or third-party Python packages were used. All commands ran inside this checkout with the requested interpreter:

```text
/root/.local/share/uv/python/cpython-3.14.7-linux-aarch64-gnu/bin/python3
```

`REPORT.md` is retained as historical source evidence, not rewritten or adopted as this review's execution record. It names another checkout and describes README additions not present in the README inspected here. Its prior Node/runtime discovery and privacy-query results are not new verification by this review.

## Concrete findings and minimal fixes

| Finding reproduced before its fix | Regression and fix |
| --- | --- |
| A writer can change the main file between SQL consumption and the only hash; the reader still returns a report. | `test_rejects_main_file_changed_during_consumption` injects a real SQLite writer during hashing. Hash before and after consumption; compare device, inode, size, nanosecond mtime/ctime, and final requested-path resolution. Reject detected changes. Hashing remains streaming; no full database copy is allocated. |
| A WAL can appear after the initial sidecar check and the reader still succeeds. | `test_rejects_sidecar_appearing_during_consumption`; recheck sidecars after the initial hash and before returning the report. |
| Dangling WAL symlinks and nonempty SHM files are accepted; a requested `github.db` symlink loses its private-filename guard during resolution. | Sidecar/private-filename regressions. Check requested and resolved sidecar paths; refuse symlinks, special files, and nonempty WAL/journal/SHM files without opening them. Check both requested/resolved filenames case-insensitively. Require a regular main file. Zero-length regular sidecars are allowed and preserved. |
| Arbitrary event types and commit years can flow into JSON; unknown visibility is silently classified as private. | Type/visibility and invalid-commit regressions. Accept only the seven declared event types and exact `public`/`private` visibility. Require integer years 1–9999 and nonnegative integer commit counts; reject malformed values without quoting them. |
| Invalid dates, arbitrary timestamp strings, and invalid non-extremum timestamps are accepted. | Timestamp-validation regression covers created/updated/ingested/success timestamps. Validate all timestamp inputs used by aggregate queries, not just selected extrema. Required event timestamps must be text; only `updated_at` may be NULL. An absent success timestamp remains unknown; a present NULL value is rejected. |
| Raw text `MAX` chooses `...00Z` over later `...00.001Z`, and `T01:00` over later SQL-format ` 02:00` on the same day. | `test_timestamp_extrema_use_chronology_not_raw_text`. Validate and normalize to fixed-width UTC timestamp keys before SQL extrema; format report timestamps as canonical UTC with insignificant fractional zeros removed. |
| Views can impersonate required archive tables, and duplicate privacy rows can let the first marker decide safety. | Schema/duplicate-metadata regressions. Require actual tables and the consumed columns, run `PRAGMA quick_check`, disable trusted schema, reject duplicate privacy/success keys. SQLite failures produce a fixed diagnostic, empty stdout, exit 1; untrusted schema/data text is not echoed. |

Additional checks preserve private yearly totals without selecting or exporting repository/content/identifier fields, byte-identical repeat output for the same snapshot, unknown empty-cache coverage, per-type freshness, and unchanged fixture/database/sidecar bytes. Integer aggregate overflow is rejected with empty stdout rather than partial JSON or a traceback. This overflow test exercised an already failing-closed SQLite error path, not an independently discovered acceptance bug.

## Exact red/green evidence

`PY` below denotes the absolute interpreter above; each command was run, not inferred.

| Stage | Command | Observed result |
| --- | --- | --- |
| Original baseline | `PY -B tests/factory-cache.test.py -v` | Exit 0; all 5 original tests passed; unittest reported 1.099 s. |
| Reproductions, original production reader | `PY -B tests/factory-cache.test.py -v` | Exit 1; 17 tests, 31 failing assertions including subtests; unittest reported 6.335 s. Failures were acceptance of unsafe inputs/mutation or the wrong chronological timestamp, not fixture setup/import failures. |
| Main fixes | `PY -B tests/factory-cache.test.py -v` | Exit 0; 17 tests passed; 6.255 s. |
| Follow-up malformed-success boundary | `PY -B tests/factory-cache.test.py -v FactoryCacheTests.test_rejects_null_success_timestamp_in_malformed_schema FactoryCacheTests.test_commit_integer_overflow_fails_without_partial_json` | Exit 1; NULL success timestamp accepted (1 failure); overflow boundary passed; 2 tests in 0.353 s. Then added the NULL-value rejection. |
| Final complete Python suite | `PY -B tests/factory-cache.test.py -v` | Exit 0; 19 tests passed; 6.747 s. All five baseline tests passed alongside the additions. |
| Runtime smoke | `PY -B .cache-acceptance-smoke.py` | Exit 0; `SMOKE PASS`; tool wall time 1.43 s. Harness and synthetic fixtures were removed after proof. |

File discovery, including ignored/hidden paths, found only `tests/factory-cache.test.py` as a Python test file. Its direct invocation is the complete Python suite in this checkout; no empty `unittest discover` run is being counted as verification.

## Runtime observations

The throwaway stdlib harness launched the actual CLI against `data/public.db` three ways: default path from the checkout root, default path from its `tests/` directory, and explicit database path. All returned exit 0, empty stderr, and byte-identical stdout. A direct `summarize` API call returned the same parsed report. Independent immutable SQL aggregate queries and `PRAGMA quick_check = ok` agreed with the emitted totals.

Observed public snapshot:

```text
databaseSha256=8f693edb071c11c38621eeb6070d178ca6010179fe6df4d73088b2f86a1117bb
events=10859
publicEvents=9414
privateEvents=1445
summed commits=3682
lastSuccessfulCollectionAt=2026-10-13T18:23:37.338Z
lastRowIngestedAt=2026-10-13T18:23:33Z
latestEventCreatedAt=2026-10-13T18:22:32Z
eventHighWaterAt=2026-10-13T18:22:32Z
```

Independent before/after hashes, device/inode, size, mtime, and ctime matched. Only `public.db` existed in the database/sidecar inventory; no WAL/journal/SHM file was created. Access times were not checked.

A synthetic CLI snapshot with a URI-sensitive filename (`public #?.db`) contained sentinel private identifiers, repositories, URLs, titles, and excerpts. The CLI emitted exactly 2 private events and 9 private commits without any `SECRET` sentinel in stdout/stderr. It selected the later millisecond creation and SQL-format ingestion timestamps correctly. After inserting a sentinel malformed `finished_at`, it returned exit 1, empty stdout, no sentinel disclosure, and no traceback. These are offline fixture privacy checks, not inspection of any private database or live authorization.

Memory was sampled through `/proc/meminfo` during review and at three smoke checkpoints. The lowest observed available-memory sample was 2,500,956 KiB; smoke samples were 2,556,384 / 2,523,388 / 2,521,696 KiB. The smoke guard stops below 1,572,864 KiB (1.5 GiB, conservatively above 1.5 decimal GB); no sampled value crossed that threshold. Sampling is not continuous memory telemetry.

## Unresolved limitations and consumer requirements

1. **Frozen input remains mandatory.** SQLite `immutable=1` disables locking/change detection; the helper does not freeze, checkpoint, or atomically acquire a snapshot. Repeated hashes/stat checks detect the exercised mutation cases but do not prove race-free reads against an adversarial writer, transient sidecars created and removed between checks, or changes after the final check. The consumer must independently pin the same frozen bytes for metadata and subsequent event reads. Hardlink aliases and arbitrary renamed databases cannot be identified as private by filename alone.
2. **Public-safe is a publisher assertion.** Validation restricts metadata fields and prevents the exercised synthetic disclosures; it does not inspect/redact every content column or verify current repository visibility. The null-repository and stale-public-row collector risks documented in `REPORT.md` remain outside scope. No collector fix or live privacy verification was performed.
3. **Strict timestamp/data domain.** Accepted times are SQLite UTC `YYYY-MM-DD HH:MM:SS` or UTC `YYYY-MM-DDTHH:MM:SS[.1–6 digits]Z`, with real calendar dates. Numeric offsets, timezone-less `T` timestamps, leap seconds, and greater-than-microsecond fractions are rejected, not guessed/truncated. Unknown event types/visibility and malformed aggregates fail closed rather than extending contract v1. Missing success metadata is unknown, not evidence of successful refresh.
4. **Not a complete schema/content audit.** Checks require tables/columns consumed by this helper and SQLite quick integrity, not every original constraint, unused table, or privacy-redaction invariant. Aggregate integer overflow fails closed; there is no fallback to lossy numeric totals. Generic SQLite diagnostics intentionally trade error specificity for non-disclosure.
5. **Cache coverage stays unknown.** Notifications and incoming replies are not collected; excerpts and aggregate counts cannot establish inbox state, complete history, or absence of work. Collector caps and nonincremental discussion support remain declared. No new freshness or completeness claim is inferred from the database hash.
6. **Verification boundary.** Python stdlib unit/CLI/API behavior only. No Node/npm tests, TypeScript checking, build/export generation, browser tests, CI execution, deployment, network acquisition, factory-side integration, live GitHub queries, or mutation score was verified or claimed. Changes are local for the parent's independent review; no remote publication occurred.
