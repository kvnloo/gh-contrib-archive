# API delivery measurements

Baseline (five requests, no credential):

```sh
node scripts/probe-api.mjs
```

A/B comparison after provisioning an approved mirror, serving the **same** snapshot:

```sh
node scripts/probe-api.mjs --samples 5 \
  --url https://kvnloo.github.io/gh-contrib-archive/api/v1/attention.json \
  --url https://YOUR-MIRROR.example/api/v1/attention.json
```

Use the corresponding `bootstrap.json` URLs after that endpoint is deployed. This script does not provision infrastructure or change hosting/DNS.

## Measurement contract

- Runs 1–10 samples on 1–2 URLs, sequentially, alternating AB/BA order.
- Defaults to a 5-second deadline and caps each decoded body at 256 KiB. No hidden retries, credentials, query strings, or redirects.
- Records time to response headers, full response/validation time, decoded bytes, response hash, and selected cache headers. Decoded bytes are **not** compressed wire bytes.
- Records all failures rather than dropping slow/error samples from the report. No response body is printed.
- Reports first-request and repeat-request medians without claiming cold-cache/warm-cache state.
- An A/B result is comparable only if every request succeeded and every response body is byte-identical. A faster stale/missing replica cannot win.
- These timings belong to the process running the script, **not ChatGPT's browsing/connector egress**. They do not isolate BGP, DNS, TLS, or provider/tool overhead. Small samples are diagnostics, not an SLO claim.

Exit status is nonzero for network/schema failures or incomparable A/B content. Use a successful Pages deployment's URL as the baseline before considering an alternative provider. Save stdout as a receipt; no paid service or domain migration is needed for the baseline.

## Tests

```sh
node --experimental-strip-types --test tests/api-delivery-probe.test.ts
```

Tests include real loopback HTTP reads and a stalled-response deadline, plus bounded bodies, non-public/invalid JSON responses, mismatched replicas, order balancing, and budget validation. Internet connectivity is not required for the tests.
