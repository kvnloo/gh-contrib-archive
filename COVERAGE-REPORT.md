# Cached coverage audit — local review receipt

## Scope and rules

Read the original local `AGENTS.md` and `REPORT.md` first, then `CONTRIBUTING.md`, `SECURITY.md`, and the orient/TDD/anti-slop guidance. Inspected the existing Python reader, fixture conventions, SQLite schema, and relevant collector sections before editing.

This is an explicitly assigned, bounded local task, not an autodevelop issue-selection pass. No fetch, issue lookup/claim, remote API call/write, push, PR, comment, merge, credential access, installation, subagent, browser test, provider fallback, or other-checkout change was performed. All created files and temporary fixtures stayed in this source directory. No private database was opened.

Retained additions:

- `scripts/coverage-audit.py`: standalone Python stdlib aggregate CLI.
- `tests/coverage-audit.test.py`: eight test-first SQLite-fixture regression tests.
- `COVERAGE-REPORT.md`: usage, semantics, and exact local evidence.

`factory-cache.py`, collector code, schema, existing tests, CI, and existing documentation were not modified. Both temporary smoke harnesses were removed after successful verification. Fixtures remove themselves. No factory-side integration or live privacy verification is claimed.

## Usage and output semantics

Use an existing Python runtime; no dependencies or installation required:

```text
python3 scripts/coverage-audit.py
python3 scripts/coverage-audit.py --db data/public.db \
  --start-year 2016 --end-year 2026 \
  --as-of 2026-10-14T03:11:51.953554+00:00 --stale-days 7
python3 tests/coverage-audit.test.py -v
```

The default database path is anchored to the checkout, not the process working directory. Default observation time is current UTC; default year range is 2016 through the observation year. Explicit observation times require a timezone. Success emits JSON containing only aggregate counts, classifications, known event-type labels, yearly cap flags, and fixed warnings. It emits no contribution IDs, repository names, identities, titles, bodies, URLs, arbitrary metadata, or unknown event-type strings. Failures return exit 1 with empty stdout and fixed diagnostics that do not echo supplied paths, values, or SQLite errors. Coverage warnings alone do not make the CLI fail.

Interpretation:

- `missing-unknown`: no commit bucket for that requested year. Commit counts are `null`, not zero.
- `cached-zero`: at least one bucket exists and its summed count is zero. This is a cached zero, not certified absence of activity. The real cache has no such year in the audited range; the zero case is exercised by fixtures.
- `cached-nonzero`: buckets have a nonzero sum, without a completeness claim.
- Missing public/private bucket categories remain `null` even when another category exists. In particular, no private bucket in 2026 is not proof of zero private commits.
- `publicRepositories` counts distinct non-null public repository values inside SQLite; names are never selected into output. `repositoryCapFlag` is true at 100 or more. Private buckets are yearly aggregates and do not reveal a private repository count. Below-cap years, zero visible repositories, and missing-year false flags do not prove complete collection or cap exhaustion.
- `privateEvents` and `privateCommits` aggregate all non-public visibility rows, matching the existing helper's convention; they are not an identity or authorization assertion.
- `rowAgeSeconds` measures the latest row ingestion for that type, rounded to the nearest second. It is not event creation, last edit, last successful collection, or a per-type successful refresh receipt. SQL timestamp interpretation handles both SQLite UTC text and ISO timestamps with offsets.
- With the default threshold, `stale-row` means row age **greater than** 604,800 seconds; exactly seven days is `recent-row`. No rows, invalid ingestion timestamps, and future ingestion are unknown classifications, never a freshness/completeness claim. An invalid ingestion timestamp anywhere in a known type makes that type's age unknown.
- `incrementalRefreshSupported` is collector capability, not evidence that every row was refreshed. Discussions and discussion comments are unsupported even if their latest row is recent. Reviews retain search/nested pagination limitations; bodyless review states are not a reliable ledger.
- Commit buckets have no refresh timestamps. Historical commit years are not continuously refreshed. No year is treated as fresh based on event ingestion or `finished_at`.
- `coverage.completeness` always remains `unknown`. Inbox/pending-response state is unavailable, and incoming replies are not generally collected. Empty counts cannot mean that no response is needed.

## Read-only and resource boundaries

Uses SQLite `mode=ro&immutable=1` against an existing snapshot. Refuses the private `github.db` filename, missing input, a missing/non-public-safe marker, and nonempty WAL/journal sidecars. Does not checkpoint, recover, copy, collect, or mutate the database. The caller must keep the checkpointed snapshot frozen throughout reading; immutable mode does not lock out another writer. A public-safe marker is a publisher assertion, not current authorization or live visibility verification.

Available-memory checks run before database access, between event and commit aggregation, and before returning output. The phone cutoff is interpreted conservatively as 1.5 GiB: **1,572,864 KiB** of `MemAvailable`. Below that value, the CLI stops with no aggregate output. Missing memory information also stops the audit. Checks are sampled, not continuous monitoring.

All sampled real available-memory values during this task exceeded the cutoff. Lowest tool-observed value was **2,515,784 KiB**; the actual-cache smoke's minimum was **2,527,736 KiB**. The last explicit task sample was **2,603,588 KiB**. A separate synthetic-memory smoke forced the low-memory branch without allocating memory: 1,572,863 KiB stopped before SQLite access with empty stdout and exit 1; exactly 1,572,864 KiB passed the guard; missing `MemAvailable` was refused. No real low-memory stop condition was observed.

## Exact test results

Existing runtime used for every Python command (`PY` below):

```text
/root/.local/share/uv/python/cpython-3.14.7-linux-aarch64-gnu/bin/python3
```

| Command/scenario | Observed result |
| --- | --- |
| `PY tests/coverage-audit.test.py -v`, before adding production CLI | Exit 1; `Ran 8 tests in 1.078s`; `FAILED (failures=8)`. The CLI file was absent: successful-path fixtures received subprocess exit 2, and refusal-path fixtures expected exit 1 rather than the absent-file exit 2. |
| Same command after adding production CLI | Exit 0; `Ran 8 tests in 2.846s`; `OK`; all eight named tests passed. |
| `PY tests/factory-cache.test.py -v` | Exit 0; `Ran 5 tests in 1.084s`; `OK`; all five existing reader tests passed. |
| `PY .coverage-smoke.py`, temporary harness invoking the actual CLI twice | Exit 0. Both subprocesses exited 0 with empty stderr; identical output from the source directory and its `tests` directory using the same observation time. Independent aggregate SQL comparisons passed for event counts and every requested year's bucket/commit/distinct-repository counts and cap flag. No inbox/completeness claim or content field appeared. |
| Immutable actual-cache `PRAGMA quick_check` in that harness | `ok`. Integrity check only; not a privacy or live-completeness check. |
| Actual-cache before/after file hashes and file set | Identical. One matching file (`public.db`) before and after; no WAL/SHM/journal sidecars appeared. |
| `PY .coverage-memory-smoke.py`, temporary resource-boundary harness | Exit 0; `memory cutoff smoke: below cutoff refused before SQLite; exact cutoff accepted; unknown memory refused`. Uses synthetic memory text; no database access or real memory pressure. |

The eight coverage fixtures exercise:

1. Missing year versus explicit cached zero; missing visibility category versus zero.
2. Per-year 99/100/101 repository cap boundaries; duplicate public repository values and private yearly aggregates do not inflate the distinct count.
3. Per-type ingestion freshness versus creation/edit/success timestamps; mixed UTC/offset formats; exact seven-day boundary; stale reviews; recent but non-refreshed discussion comments; absent types.
4. Empty-cache unknown coverage, no-inbox/incoming-reply caveats, and refresh limitations.
5. Synthetic forbidden content/identity values, unknown event types, malformed ingestion timestamps, and future rows do not leak or imply freshness.
6. Successful read preserves fixture database bytes and the directory file set.
7. Unmarked/private/missing inputs and active WAL/journal sidecars fail without disclosure or modification.
8. Invalid observation times, year ranges, and stale thresholds fail without echoing supplied values.

No npm/Node tests, build, GitHub Actions, deployment, collector execution, mutation testing, remote completeness check, live privacy check, or factory integration was performed. Mutation is `n/a` under the repository rules.

## Actual cached findings

Reproducible observation time from the machine clock: **2026-10-14T03:11:51.953554+00:00**. This clock value is the audit reference, not an assumed session date. Range: **2016–2026**; stale threshold: **7 days**.

Aggregate event counts: **10,859** total, **9,414** public, **1,445** non-public/redacted; **0** unknown-type events. **1** missing year; **1** capped year; **2** stale event types; **2** non-incrementally-refreshed types; **0** empty known types; **0** unknown known-type freshness values.

| Year | Cached commits | Public commits | Private aggregate | Public repositories | Cap flag |
| --- | ---: | ---: | ---: | ---: | --- |
| 2016 | 137 | 53 | 84 | 3 | false |
| 2017 | 617 | 154 | 463 | 7 | false |
| 2018 | 175 | 45 | 130 | 5 | false |
| 2019 | 21 | 2 | 19 | 1 | false |
| 2020 | 19 | unknown | 19 | 0 | false |
| 2021 | unknown | unknown | unknown | unknown | false; missing year |
| 2022 | 115 | unknown | 115 | 0 | false |
| 2023 | 4 | unknown | 4 | 0 | false |
| 2024 | 119 | 6 | 113 | 1 | false |
| 2025 | 528 | 386 | 142 | 25 | false |
| 2026 | 1,947 | 1,947 | unknown | 100 | **true** |

Observed bucket totals sum to **3,682** commits: **2,593** public and **1,089** non-public aggregate counts. These totals exclude unknown/missing activity; they are not complete history.

| Type | Events | Public | Private aggregate | Latest row age, seconds | Classification | Incremental support |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| issue | 1,880 | 1,545 | 335 | 31,729 | recent-row | yes |
| pull_request | 2,896 | 2,482 | 414 | 31,735 | recent-row | yes |
| comment | 5,595 | 4,912 | 683 | 31,709 | recent-row | yes |
| review | 404 | 403 | 1 | 31,699 | recent-row | yes, limited |
| review_comment | 73 | 61 | 12 | 31,699 | recent-row | yes, limited |
| discussion | 9 | 9 | 0 | 2,779,192 | **stale-row** | **no** |
| discussion_comment | 2 | 2 | 0 | 2,779,192 | **stale-row** | **no** |

Both discussion types' latest cached ingestion is roughly 32 days old. Recent ingestion for the other types is not proof of complete historical coverage, incoming replies, or a usable inbox.

Database byte-preservation receipt, SHA-256 before **and** after:

```text
8f693edb071c11c38621eeb6070d178ca6010179fe6df4d73088b2f86a1117bb
```

Local additions are retained for parent independent review. No integration, publication, live authorization, or remote write follows from this evidence.
