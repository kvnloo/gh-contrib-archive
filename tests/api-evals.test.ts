import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { collectAggregateMetrics, evaluateApiFixture, evaluateCollectorBudget, type EvalFixture } from "../lib/api-evals.ts";

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "api-evals-"));
  fs.mkdirSync(path.join(root, "api/v1"), { recursive: true });
  const resources: Record<string, unknown> = {
    "bootstrap.json": { schemaVersion: 1, privacy: "public-safe", revision: `sha256:${"a".repeat(64)}`, count: 2 },
    "queues.json": { schemaVersion: 1, privacy: "public-safe", revision: `sha256:${"b".repeat(64)}`, counts: { needs_action: 1 } },
    "recent.json": { schemaVersion: 1, privacy: "public-safe", revision: `sha256:${"c".repeat(64)}`, count: 1 },
    "actors.json": { schemaVersion: 1, privacy: "public-safe", revision: `sha256:${"d".repeat(64)}`, count: 1 },
    "semantic.json": { schemaVersion: 1, privacy: "public-safe", revision: `sha256:${"e".repeat(64)}`, repos: [] },
  };
  for (const [name, value] of Object.entries(resources)) fs.writeFileSync(path.join(root, "api/v1", name), JSON.stringify(value) + "\n");
  const fixture: EvalFixture = {
    schemaVersion: 1,
    privacy: "synthetic",
    collectorBudgets: { cold: { maxRequests: 5, minCacheHits: 0 }, warm: { maxRequests: 1, minCacheHits: 2 }, oneChanged: { maxRequests: 3, minCacheHits: 1 } },
    readContracts: [
      { id: "next-action", endpoint: "bootstrap.json", maxReads: 1, maxBytes: 16384 },
      { id: "work-queue", endpoint: "queues.json", maxReads: 1 },
      { id: "recent-change", endpoint: "recent.json", maxReads: 1 },
      { id: "actor-context", endpoint: "actors.json", maxReads: 1 },
      { id: "semantic-links", endpoint: "semantic.json", maxReads: 1 },
    ],
  };
  return { root, fixture };
}

describe("api evals + analytics", () => {
  it("scores synthetic read contracts without retaining payloads", () => {
    const { root, fixture } = setup();
    try {
      const report = evaluateApiFixture(root, fixture);
      assert.equal(report.passed, 5);
      assert.equal(report.failed, 0);
      assert.ok(report.cases.every((row) => !("payload" in row)));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("fails closed for missing/private resources and byte-budget regressions", () => {
    const { root, fixture } = setup();
    try {
      fs.writeFileSync(path.join(root, "api/v1/recent.json"), JSON.stringify({ schemaVersion: 1, privacy: "private", revision: `sha256:${"f".repeat(64)}` }));
      fs.writeFileSync(path.join(root, "api/v1/bootstrap.json"), JSON.stringify({ schemaVersion: 1, privacy: "public-safe", revision: `sha256:${"a".repeat(64)}`, filler: "x".repeat(20000) }) + "\n");
      fs.rmSync(path.join(root, "api/v1/actors.json"));
      const report = evaluateApiFixture(root, fixture);
      assert.equal(report.failed, 3);
      assert.deepEqual(report.cases.filter((row) => !row.ok).map((row) => row.reason).sort(), ["byte-budget", "missing-or-invalid-json", "not-public-revisioned"]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("scores versioned collector request budgets", () => {
    const { root, fixture } = setup();
    try {
      assert.equal(evaluateCollectorBudget(fixture, "cold", { requestCount: 5, cacheHits: 0 }).ok, true);
      assert.equal(evaluateCollectorBudget(fixture, "warm", { requestCount: 1, cacheHits: 2 }).ok, true);
      assert.equal(evaluateCollectorBudget(fixture, "oneChanged", { requestCount: 3, cacheHits: 1 }).ok, true);
      assert.equal(evaluateCollectorBudget(fixture, "warm", { requestCount: 3, cacheHits: 0 }).ok, false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("tracks only allowlisted aggregate collector/build metrics", () => {
    const { root, fixture } = setup();
    try {
      const report = evaluateApiFixture(root, fixture);
      const attention = { requestCount: 5, cacheHits: 4, cacheMisses: 1, deepInspected: 1, concurrency: 4, items: [{ repo: "PRIVATE_SENTINEL", title: "PRIVATE_SENTINEL", body: "PRIVATE_SENTINEL" }] };
      const metrics = collectAggregateMetrics(root, attention, report, "a".repeat(40));
      assert.equal(metrics.collector.cacheReuseRatio, 0.8);
      assert.equal(metrics.sourceSha, "a".repeat(40));
      assert.ok((metrics.reader.bootstrapBytes ?? 0) > 0);
      assert.equal(JSON.stringify(metrics).includes("PRIVATE_SENTINEL"), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
