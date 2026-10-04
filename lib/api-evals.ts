import fs from "node:fs";
import path from "node:path";

const REVISION = /^sha256:[a-f0-9]{64}$/;
const ENDPOINT = /^[A-Za-z0-9._/-]+\.json$/;

function safeEndpoint(value: string) {
  if (!ENDPOINT.test(value) || value.startsWith("/")) return false;
  return !value.split("/").some((part) => part === "." || part === "..");
}

export type EvalFixture = {
  schemaVersion: 1;
  privacy: "synthetic";
  collectorBudgets?: Record<string, { maxRequests: number; minCacheHits?: number }>;
  readContracts: Array<{
    id: string;
    endpoint: string;
    maxReads: number;
    maxBytes?: number;
  }>;
};

export type EvalReport = {
  schemaVersion: 1;
  privacy: "aggregate-only";
  fixtureVersion: number;
  total: number;
  passed: number;
  failed: number;
  cases: Array<{
    id: string;
    endpoint: string;
    ok: boolean;
    bytes: number | null;
    maxReads: number;
    maxBytes: number | null;
    reason: string | null;
  }>;
};

function readJson(file: string): { bytes: number; value: unknown } {
  const raw = fs.readFileSync(file);
  return { bytes: raw.byteLength, value: JSON.parse(raw.toString("utf8")) };
}

function publicRevisioned(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row.schemaVersion === 1 && row.privacy === "public-safe" &&
    typeof row.revision === "string" && REVISION.test(row.revision);
}

export function evaluateApiFixture(outputRoot: string, fixture: EvalFixture): EvalReport {
  if (fixture.schemaVersion !== 1 || fixture.privacy !== "synthetic" || !Array.isArray(fixture.readContracts)) {
    throw new Error("eval fixture must be schema-v1 synthetic data");
  }
  const apiRoot = path.join(outputRoot, "api", "v1");
  const cases = fixture.readContracts.map((testCase) => {
    if (!/^[a-z0-9-]{1,64}$/.test(testCase.id) || !safeEndpoint(testCase.endpoint) ||
        !Number.isInteger(testCase.maxReads) || testCase.maxReads < 1 || testCase.maxReads > 4 ||
        (testCase.maxBytes != null && (!Number.isInteger(testCase.maxBytes) || testCase.maxBytes < 256 || testCase.maxBytes > 262144))) {
      return { id: testCase.id, endpoint: testCase.endpoint, ok: false, bytes: null,
        maxReads: testCase.maxReads, maxBytes: testCase.maxBytes ?? null, reason: "invalid-contract" };
    }
    const file = path.join(apiRoot, testCase.endpoint);
    try {
      const loaded = readJson(file);
      if (!publicRevisioned(loaded.value)) return { id: testCase.id, endpoint: testCase.endpoint, ok: false,
        bytes: loaded.bytes, maxReads: testCase.maxReads, maxBytes: testCase.maxBytes ?? null, reason: "not-public-revisioned" };
      if (testCase.maxBytes != null && loaded.bytes > testCase.maxBytes) return { id: testCase.id, endpoint: testCase.endpoint, ok: false,
        bytes: loaded.bytes, maxReads: testCase.maxReads, maxBytes: testCase.maxBytes, reason: "byte-budget" };
      return { id: testCase.id, endpoint: testCase.endpoint, ok: true, bytes: loaded.bytes,
        maxReads: testCase.maxReads, maxBytes: testCase.maxBytes ?? null, reason: null };
    } catch {
      return { id: testCase.id, endpoint: testCase.endpoint, ok: false, bytes: null,
        maxReads: testCase.maxReads, maxBytes: testCase.maxBytes ?? null, reason: "missing-or-invalid-json" };
    }
  });
  const passed = cases.filter((row) => row.ok).length;
  return { schemaVersion: 1, privacy: "aggregate-only", fixtureVersion: fixture.schemaVersion,
    total: cases.length, passed, failed: cases.length - passed, cases };
}

export function evaluateCollectorBudget(
  fixture: EvalFixture,
  scenario: string,
  sample: { requestCount: number; cacheHits: number },
) {
  const budget = fixture.collectorBudgets?.[scenario];
  if (!budget) throw new Error(`unknown collector scenario: ${scenario}`);
  const requestCount = finiteNonNegative(sample.requestCount);
  const cacheHits = finiteNonNegative(sample.cacheHits);
  const ok = requestCount != null && cacheHits != null &&
    requestCount <= budget.maxRequests && cacheHits >= (budget.minCacheHits ?? 0);
  return { scenario, ok, requestCount, cacheHits, maxRequests: budget.maxRequests,
    minCacheHits: budget.minCacheHits ?? 0 };
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function jsonInventory(root: string) {
  let files = 0;
  let bytes = 0;
  if (!fs.existsSync(root)) return { files, bytes };
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const item = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(item);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        const size = fs.statSync(item).size;
        files += 1; bytes += size;
      }
    }
  }
  return { files, bytes };
}

export function collectAggregateMetrics(outputRoot: string, attentionSeed: unknown, evalReport: EvalReport, sourceSha?: string | null) {
  const row = attentionSeed && typeof attentionSeed === "object" ? attentionSeed as Record<string, unknown> : {};
  const requestCount = finiteNonNegative(row.requestCount);
  const cacheHits = finiteNonNegative(row.cacheHits);
  const cacheMisses = finiteNonNegative(row.cacheMisses);
  const deepInspected = finiteNonNegative(row.deepInspected);
  const concurrency = finiteNonNegative(row.concurrency);
  const denominator = cacheHits != null && cacheMisses != null ? cacheHits + cacheMisses : 0;
  const inventory = jsonInventory(path.join(outputRoot, "api", "v1"));
  let bootstrapBytes: number | null = null;
  try { bootstrapBytes = fs.statSync(path.join(outputRoot, "api", "v1", "bootstrap.json")).size; } catch {}
  const safeSha = typeof sourceSha === "string" && /^[a-f0-9]{40}$/.test(sourceSha) ? sourceSha : null;
  return {
    schemaVersion: 1 as const,
    privacy: "aggregate-only" as const,
    sourceSha: safeSha,
    collector: {
      source: "tracked-attention-seed" as const,
      requestCount, cacheHits, cacheMisses, deepInspected, concurrency,
      cacheReuseRatio: denominator > 0 && cacheHits != null ? cacheHits / denominator : null,
    },
    reader: { jsonFiles: inventory.files, jsonBytes: inventory.bytes, bootstrapBytes },
    evals: { total: evalReport.total, passed: evalReport.passed, failed: evalReport.failed },
  };
}
