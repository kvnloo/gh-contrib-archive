# API evals and aggregate metrics

Run `npm run eval:api` with Node 22. This uses only synthetic transport and built-in
Node modules; it makes **zero GitHub requests**. After a build, run
`npm run eval:api -- --require-export` to also validate the actual local export.

Results are in `.cache/api-evals/report.json` and `summary.md`. CI and Pages builds
run the suite, append the summary to Actions, and retain these two files as
per-job/run/attempt artifacts for 30 days, including failed evaluations. This is
per-commit history, not a visitor-analytics service or an always-on agent logger.
Concurrent jobs have distinct artifact names. Local invocations atomically replace
the report in their working directory; use separate worktrees for parallel runs.

## Frozen fixture v1

`evals/api-v1.json` is entirely synthetic. Its 12 cases model observed *categories*
of API use: verification/scope requests, requested changes, positive reviews,
bots, answered requests, failed or queued CI, approvals, supersession, conflicts,
and waiting. No real conversations, private identities, feedback, or credentials
are copied. `schemaVersion` and the fixture content hash identify the dataset.

These are small, hand-authored regression cases, not a representative evaluation
of all GitHub discussions. A perfect fixture score is **not** a production
precision/recall estimate. Grow the reviewed fixture set when a new failure is
observed; never alter expected answers merely to make a regression green.

## What is measured

| Group | Measurements | Interpretation |
| --- | --- | --- |
| Classification | Case success, P0 TP/FP/FN/TN, precision/recall | Synthetic; all failures remain in denominators. Undefined ratios are `null`. |
| Collector | Cold/warm/one-dirty-row request counts, cache hits/misses, max concurrent requests, elapsed ms | Executes the real collector with mocked transport and an isolated cache. Expected requests: 5 / 1 / 3. Warm actions/events must be identical. |
| Bootstrap | Bytes, actions, omissions, one-fetch shape, projection sentinels | Synthetic request shape, not a network latency benchmark or a full visibility audit. |
| Export | Actual bootstrap/attention bytes, link identities/revisions, bootstrap hash and cap | Local built files, never an HTTP acceptance claim. Existing full privacy tests and `dogfood:api` remain separate gates. |
| Recorded collector | Request count, hit ratio, deep inspections, configured concurrency, reported inventory coverage, snapshot age | Reads numeric fields from an existing public seed. Missing/invalid measurements are `null`. An old fallback seed is not a successful fresh collection. |

The report includes the actual checked-out Git SHA, PR head SHA separately when
available, Node version, execution origin, fixture hash, classifier version and
cache schema. A PR checkout can be a synthetic merge SHA: it is not relabeled as
the source head. A source-copy sandbox without Git records `sourceSha: null`.

Unit tests, build, API dogfood, fixtures, collector, bootstrap, export, and live
acceptance are separate gates. Workflow step outcomes populate the first three;
local runs leave them `not_run`. This suite always leaves live acceptance
`not_run` and network latency `null`. Timings are process-local diagnostics, not
ChatGPT browsing/connector egress timings. The delivery probe remains
`node scripts/probe-api.mjs`; do not pool its measurements with synthetic timing.

## Reading trends

Download the `api-evals-*` artifacts from successive Actions runs. Compare counts,
bytes, coverage, failures and cache ratios only with matching fixture revision,
suite version and classifier/cache versions. Compare timing only within the same
execution origin and runtime, using multiple samples; this slice intentionally
does not turn one cold/warm run into a p95 or a hosting recommendation. Keep
failed runs rather than selecting only successes. Review dataset/version changes
separately from performance changes.

## Privacy and failure behavior

Reports contain synthetic case IDs, booleans, counters, versions and timestamps;
not request URLs, repo/actor names, response bodies, raw exceptions or tokens.
The real seed is consumed but never attached. Reports stay outside `public/` and
`out/`; artifact uploads explicitly select just the two report files, never the
whole cache. No analytics vendor, cookie, IP/session tracking, paid infrastructure,
new secret, or additional workflow permission is introduced.

`--require-export` fails on missing/invalid files, unsafe pointers, inconsistent
bootstrap revisions or size limits. A complete report is still written on gate
failure. Harness failures use a symbolic status rather than logging raw data.
This does not replace the existing privacy/visibility regressions or claim to
verify public availability; those remain independent acceptance checks.
