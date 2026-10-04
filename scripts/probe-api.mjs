import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const MAX_BYTES = 262144;

export function validateUrl(value, allowLoopback = false) {
  const url = new URL(value);
  const loopback = allowLoopback && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error("use a public HTTPS resource URL without credentials, query, or fragment");
  }
  return url;
}

/** Times this process's fetch path, not the ChatGPT browsing/connector egress path. */
export async function probeUrl(value, options = {}) {
  const url = validateUrl(value, options.allowLoopback);
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 30000) {
    throw new RangeError("timeout must be 50..30000 milliseconds");
  }
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("deadline", "TimeoutError")), timeoutMs);
  timer.unref();
  let headersMs = null;
  let status = null;
  let failure = null;
  try {
    const response = await (options.fetcher ?? fetch)(url.href, {
      signal: controller.signal, redirect: "error", credentials: "omit",
      headers: { Accept: "application/json" },
    });
    headersMs = performance.now() - started;
    status = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      failure = `HTTP ${status}`;
      throw new Error(failure);
    }
    let decodedBytes = 0;
    const chunks = [];
    const hash = createHash("sha256");
    for await (const chunk of response.body ?? []) {
      decodedBytes += chunk.byteLength;
      if (decodedBytes > MAX_BYTES) {
        failure = `response exceeds ${MAX_BYTES} decoded bytes`;
        throw new RangeError(failure);
      }
      chunks.push(chunk); hash.update(chunk);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (payload?.schemaVersion !== 1 || payload?.privacy !== "public-safe") {
      failure = "response is not a schema-v1 public projection";
      throw new Error(failure);
    }
    const cache = Object.fromEntries(["age", "etag", "cache-control", "x-cache", "cf-cache-status", "x-vercel-cache"]
      .map((name) => [name, response.headers.get(name)?.slice(0, 160) ?? null]));
    return { url: url.href, ok: true, status, headersMs, totalMs: performance.now() - started,
      decodedBytes, bodyHash: `sha256:${hash.digest("hex")}`, cache };
  } catch (error) {
    // Do not print response bodies or arbitrary exception messages containing URLs/data.
    return { url: url.href, ok: false, status, headersMs, totalMs: performance.now() - started,
      error: failure ?? (error instanceof Error ? error.name : "fetch-error"),
      errorCode: /^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET)$/.test(error?.cause?.code ?? "") ? error.cause.code : null, cache: {} };
  } finally {
    clearTimeout(timer); controller.abort();
  }
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export async function compareRoutes(values, options = {}) {
  const samples = options.samples ?? 5;
  if (values.length < 1 || values.length > 2 || !Number.isInteger(samples) || samples < 1 || samples > 10) {
    throw new RangeError("use 1..2 routes and 1..10 samples per route");
  }
  const urls = values.map((value) => validateUrl(value, options.allowLoopback).href);
  if (new Set(urls).size !== urls.length) throw new RangeError("A/B routes must be distinct");
  const results = [];
  for (let round = 0; round < samples; round += 1) {
    // Alternate AB/BA to avoid always giving one route the first request in a pair.
    const order = round % 2 ? [...urls].reverse() : urls;
    for (const url of order) results.push({ round, ...await probeUrl(url, options) });
  }
  const routes = urls.map((url) => {
    const rows = results.filter((row) => row.url === url);
    const successes = rows.filter((row) => row.ok);
    return { url, samples: rows.length, successes: successes.length, failures: rows.length - successes.length,
      firstRequestMs: rows[0].ok ? rows[0].totalMs : null,
      medianMs: median(successes.map((row) => row.totalMs)),
      repeatMedianMs: median(successes.filter((row) => row.round > 0).map((row) => row.totalMs)) };
  });
  const successful = results.filter((row) => row.ok);
  const comparable = urls.length === 2 && successful.length === results.length &&
    new Set(successful.map((row) => row.bodyHash)).size === 1;
  return { measurementOrigin: "this-process-not-chatgpt-egress", sampledAt: new Date().toISOString(),
    requestCount: results.length, comparable,
    comparisonRule: "all samples successful and byte-identical; no automatic hosting winner",
    routes, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: {
      url: { type: "string", multiple: true }, samples: { type: "string", default: "5" },
      timeout: { type: "string", default: "5000" },
    } });
    const urls = values.url ?? ["https://kvnloo.github.io/gh-contrib-archive/api/v1/attention.json"];
    const report = await compareRoutes(urls, { samples: Number(values.samples), timeoutMs: Number(values.timeout) });
    console.log(JSON.stringify(report, null, 2));
    if (report.routes.some((row) => row.failures) || (urls.length === 2 && !report.comparable)) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "probe failed"); process.exitCode = 1;
  }
}
