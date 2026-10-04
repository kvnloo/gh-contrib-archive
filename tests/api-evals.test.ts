import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { evaluateFixtures, collectorMetrics, evaluateCollector, evaluateExport } from "../scripts/eval-api.ts";
import { contentRevision } from "../lib/resource-revision.ts";

const fixture = JSON.parse(fs.readFileSync(new URL("../evals/api-v1.json", import.meta.url), "utf8"));
const now = Date.parse("2026-01-01T01:00:00Z");

describe("API evaluation and aggregate analytics", () => {
  it("scores every versioned synthetic case without recording its text", () => {
    const result = evaluateFixtures(fixture);
    assert.equal(result.passed, fixture.cases.length);
    assert.equal(result.p0.precision, 1);
    assert.equal(result.p0.recall, 1);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("Please run"), false);
    assert.equal(serialized.includes("fixture/repo"), false);
  });

  it("keeps false negatives in both the score and recall denominator", () => {
    const changed = structuredClone(fixture);
    changed.cases[0].snapshot.activities = [];
    const result = evaluateFixtures(changed);
    assert.equal(result.passed, fixture.cases.length - 1);
    assert.equal(result.p0.fn, 1);
    assert.ok(result.p0.recall! < 1);
    assert.equal(result.cases[0].passed, false);
  });

  it("rejects empty or duplicate fixtures rather than awarding vacuous success", () => {
    assert.throws(() => evaluateFixtures({ ...fixture, cases: [] }));
    assert.throws(() => evaluateFixtures({ ...fixture, cases: [fixture.cases[0], fixture.cases[0]] }));
  });

  it("projects counters, coverage and age without copying identities or raw fields", () => {
    const metrics = collectorMetrics({
      schemaVersion: 1, privacy: "public-safe", source: "github-public-rest-hotset",
      updatedAt: "2026-01-01T00:00:00Z", requestCount: 5, cacheHits: 2, cacheMisses: 2,
      cachedOpen: 4, totalOpenReportedBySearch: 10, deepInspected: 2, concurrency: 2,
      items: [{ repo: "SYNTHETIC_PRIVATE_REPO", body: "SYNTHETIC_BODY" }], token: "SYNTHETIC_TOKEN",
    }, now);
    assert.equal(metrics.status, "recorded");
    assert.equal(metrics.cacheHitRatio, 0.5);
    assert.equal(metrics.inventoryCoverage, 0.4);
    assert.equal(metrics.snapshotAgeMs, 3_600_000);
    assert.equal(JSON.stringify(metrics).includes("SYNTHETIC"), false);
  });

  it("never turns absent, invalid, or future telemetry into zero-cost success", () => {
    assert.equal(collectorMetrics(null, now).status, "unavailable");
    const base = { schemaVersion: 1, privacy: "public-safe", source: "github-public-rest-hotset" };
    const metrics = collectorMetrics({ ...base, requestCount: -1, cacheHits: "5", cacheMisses: 0,
      updatedAt: "2027-01-01T00:00:00Z" }, now);
    assert.equal(metrics.requestCount, null);
    assert.equal(metrics.cacheHitRatio, null);
    assert.equal(metrics.snapshotAgeMs, null);
    assert.equal(metrics.timestampStatus, "future");
    assert.equal(collectorMetrics({ ...base, privacy: "private" }, now).status, "unavailable");
  });

  it("executes the real collector cold, warm and dirty with identical warm events", async () => {
    const result = await evaluateCollector();
    assert.equal(result.status, "pass");
    assert.deepEqual(result.runs.map((run) => run.requestCount), [5, 1, 3]);
    assert.equal(result.warmContentEqual, true);
    assert.equal(result.privacyPass, true);
    assert.equal(result.requestsAvoidedWarm, 4);
  });

  it("checks bootstrap identity/revisions/bytes without logging exported content", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "api-eval-export-"));
    try {
      const thread = { schemaVersion: 1, privacy: "public-safe", repo: "fixture/repo", number: 1,
        revision: "sha256:" + "a".repeat(64) };
      const item = { repo: thread.repo, number: 1, priority: "P0", nextAction: "synthetic action",
        thread: { href: "threads/fixture/repo/1.json", revision: thread.revision } };
      const semantic = { schemaVersion: 1, privacy: "public-safe", kind: "agent-bootstrap",
        items: [item], count: 1, actionableCached: 1, omitted: 0, truncated: false, maxBytes: 16384 };
      const packet = { ...semantic, revision: contentRevision(semantic),
        source: { updatedAt: "2026-01-01T00:00:00Z", revision: thread.revision } };
      fs.mkdirSync(path.join(root, "threads/fixture/repo"), { recursive: true });
      const write = (name: string, value: unknown) => fs.writeFileSync(path.join(root, name), JSON.stringify(value));
      write("bootstrap.json", packet);
      write("attention.json", { privacy: "public-safe", items: [item], revision: thread.revision });
      write("threads/fixture/repo/1.json", thread);
      assert.equal(evaluateExport(root, now).status, "pass");
      thread.revision = "sha256:" + "b".repeat(64);
      write("threads/fixture/repo/1.json", thread);
      assert.equal(evaluateExport(root, now).status, "fail");
      item.thread.href = "../outside.json";
      write("bootstrap.json", { ...packet, items: [item] });
      assert.equal(evaluateExport(root, now).status, "fail");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("writes a failed receipt when the required built export is missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "api-eval-cli-"));
    try {
      const script = fileURLToPath(new URL("../scripts/eval-api.ts", import.meta.url));
      const run = spawnSync(process.execPath, ["--experimental-strip-types", script, "--require-export"], {
        cwd: root, encoding: "utf8", timeout: 30_000,
        env: { PATH: process.env.PATH, HOME: root },
      });
      assert.equal(run.status, 1);
      const report = JSON.parse(fs.readFileSync(path.join(root, ".cache/api-evals/report.json"), "utf8"));
      assert.equal(report.gates.export, "fail");
      assert.equal(report.gates.liveAcceptance, "not_run");
      assert.equal(report.provenance.sourceSha, null);
      assert.equal(report.provenance.origin, "local");
      assert.equal(report.synthetic.collector.status, "pass");
      assert.equal(JSON.stringify(report).includes(root), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it("retains aggregate-only failed-run receipts in validation and deployment", () => {
    for (const name of ["ci.yml", "deploy-pages.yml"]) {
      const yaml = fs.readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
      assert.match(yaml, /Evaluate API[\s\S]*if: always\(\)[\s\S]*npm run eval:api -- --require-export/);
      assert.match(yaml, /Retain API evaluation history[\s\S]*if: always\(\)/);
      assert.match(yaml, /include-hidden-files: true/);
      assert.match(yaml, /retention-days: 30/);
      assert.match(yaml, /path: \|\n            \.cache\/api-evals\/report\.json\n            \.cache\/api-evals\/summary\.md/);
      assert.match(yaml, /EVAL_BUILD_OUTCOME:.*steps\.build\.outcome/);
      assert.doesNotMatch(yaml, /continue-on-error:/);
    }
  });

});
