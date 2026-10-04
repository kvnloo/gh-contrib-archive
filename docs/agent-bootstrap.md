# One-request agent entrypoint

Fetch `/gh-contrib-archive/api/v1/bootstrap.json` to answer “what should I work on next?” without first fetching the index, attention queue, and an individual thread.

`npm run export:api` writes this packet **after** the public API materializer, using only its already-filtered attention rows and matching public thread resources. It never reads a raw seed or makes a GitHub request. Start here directly; the existing resource index and its hash contract are unchanged.

The default compact UTF-8 response is capped at **16 KiB / 12 actions**, ordered by priority, latest source activity, then stable thread identity. `P2` waiting rows are omitted. Each action has a canonical GitHub URL and a relative cached thread href/revision for optional deeper reading.

- `revision` hashes the semantic packet, excluding `revision` itself and `source`.
- `source.updatedAt` and `source.revision` describe the attention snapshot used. Freshness is not a claim that a live GitHub read occurred now.
- `actionableCached`, `count`, `omitted`, and `truncated` describe only cached actionable rows, **not all authored GitHub PRs**.
- Long display fields are clipped. Follow the thread href for full projected context.
- Unknown properties, raw bodies, credentials, and supplied upstream URLs are not copied. An attention row without a matching public thread is excluded.

Revisions are validation tokens, not immutable URLs. Two sequential reads may span deployments: compare revisions and retry a bounded number of times rather than assuming a multi-request transaction.

## Verification

```sh
node --experimental-strip-types --test tests/agent-bootstrap.test.ts
npm run build
npm run dogfood:api
```

The focused tests cover the two motivating T3 PR fixtures, deterministic ordering, privacy projection, invalid/mismatched thread identities, freshness-only refreshes, byte limits with multibyte Unicode, and exact emitted bytes. Full build, live response verification, and network measurements remain separate gates.
