import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifyPullRequest, type PullRequestSnapshot } from "../lib/attention.ts";
import { compileAgentBootstrap } from "../lib/agent-bootstrap.ts";
import { contentRevision } from "../lib/resource-revision.ts";
import { PUBLIC_ATTENTION_CLASSIFIER_VERSION, PUBLIC_ATTENTION_CACHE_SCHEMA } from "../lib/public-attention-cache.ts";

type Json = Record<string, any>;
type Fixture = { schemaVersion: number; source: string; selfLogin: string; defaults: PullRequestSnapshot;
  cases: { id: string; snapshot: Partial<PullRequestSnapshot>; expected: { priority: string; blocker: string; ciState: string } }[] };
const REVISION = /^sha256:[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const ratio = (a: number | null, b: number | null) => a !== null && b !== null && b > 0 && a <= b ? a / b : null;

/** Fixed synthetic IDs and booleans only; never emit input/actual feedback text. */
export function evaluateFixtures(fixture: Fixture) {
  if (fixture.schemaVersion !== 1 || fixture.source !== "synthetic" || !Array.isArray(fixture.cases) ||
      fixture.cases.length < 1 || fixture.cases.length > 100 ||
      new Set(fixture.cases.map((item) => item.id)).size !== fixture.cases.length) throw new Error("invalid eval fixture");
  const p0 = { tp: 0, fp: 0, fn: 0, tn: 0 };
  const cases = fixture.cases.map((item) => {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(item.id) || !["P0", "P1", "P2"].includes(item.expected.priority)) {
      throw new Error("invalid eval case");
    }
    const actual = classifyPullRequest({ ...fixture.defaults, ...item.snapshot }, fixture.selfLogin);
    const wantedP0 = item.expected.priority === "P0";
    const gotP0 = actual.priority === "P0";
    p0[wantedP0 ? (gotP0 ? "tp" : "fn") : (gotP0 ? "fp" : "tn")] += 1;
    const priority = actual.priority === item.expected.priority;
    const blocker = actual.blocker === item.expected.blocker;
    const ciState = actual.ciState === item.expected.ciState;
    return { id: item.id, passed: priority && blocker && ciState, priority, blocker, ciState };
  });
  return { total: cases.length, passed: cases.filter((item) => item.passed).length, cases,
    p0: { ...p0, precision: ratio(p0.tp, p0.tp + p0.fp), recall: ratio(p0.tp, p0.tp + p0.fn) } };
}

function age(value: unknown, now: number) {
  const parsed = typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) ? Date.parse(value) : NaN;
  return { snapshotAgeMs: Number.isFinite(parsed) && parsed <= now ? now - parsed : null,
    timestampStatus: !Number.isFinite(parsed) ? "unknown" : parsed > now ? "future" : "valid" };
}

/** Reads existing seed counters only. Recorded is NOT a fresh-success or live-acceptance claim. */
export function collectorMetrics(value: unknown, now = Date.now()) {
  const raw = value && typeof value === "object" ? value as Json : {};
  const valid = raw.schemaVersion === 1 && raw.privacy === "public-safe" && raw.source === "github-public-rest-hotset";
  const n = (key: string) => valid ? count(raw[key]) : null;
  const hits = n("cacheHits"), misses = n("cacheMisses"), cached = n("cachedOpen"), inventory = n("totalOpenReportedBySearch");
  return { status: valid ? "recorded" : "unavailable", ...age(valid ? raw.updatedAt : null, now),
    requestCount: n("requestCount"), cacheHits: hits, cacheMisses: misses,
    cacheHitRatio: ratio(hits, hits !== null && misses !== null ? hits + misses : null),
    cachedOpen: cached, inventoryReported: inventory, inventoryCoverage: ratio(cached, inventory),
    deepInspected: n("deepInspected"), configuredConcurrency: n("concurrency") };
}

function readJson(file: string, limit = 16 * 1024 * 1024) {
  if (fs.statSync(file).size > limit) throw new Error("eval input too large");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Real collector, synthetic transport, isolated cache; no GitHub credentials or network. */
export async function evaluateCollector() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "api-collector-eval-"));
  const runs: Json[] = [];
  const states: Json[] = [];
  const policyFile = path.join(root, "policy.json");
  const cacheFile = path.join(root, ".cache", "public-attention.json");
  fs.writeFileSync(policyFile, JSON.stringify({ schemaVersion: 1, recentDays: 60, pins: [] }));
  let privacyPass = true;
  try {
    for (const phase of ["cold", "warm", "dirty"]) {
      const started = performance.now();
      const child = spawnSync(process.execPath, ["--experimental-strip-types", "--import",
        new URL("../evals/mock-github.mjs", import.meta.url).href,
        fileURLToPath(new URL("./public-attention-sync.ts", import.meta.url))], {
        cwd: root, encoding: "utf8", timeout: 10_000, maxBuffer: 512 * 1024,
        env: { PATH: process.env.PATH, HOME: root, NODE_NO_WARNINGS: "1", GITHUB_TOKEN: "", GH_TOKEN: "",
          GITHUB_PUBLIC_LOGIN: "fixture-self", PUBLIC_ATTENTION_CONCURRENCY: "2", PUBLIC_ATTENTION_DEEP_LIMIT: "2",
          PUBLIC_ATTENTION_SEARCH_INTERVAL_MS: "0", PUBLIC_ATTENTION_POLICY: policyFile, PUBLIC_ATTENTION_CACHE: cacheFile,
          API_EVAL_DIRTY: phase === "dirty" ? "1" : "0" },
      });
      const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
      if (child.status !== 0 || child.error) { runs.push({ phase, status: "fail", elapsedMs }); break; }
      try {
      const seed = readJson(path.join(root, "data/attention-seed.json"));
      const transport = readJson(path.join(root, "transport.json"));
      const cache = readJson(cacheFile);
      privacyPass &&= !/SYNTHETIC_(FEEDBACK|TOKEN)_SENTINEL/.test(JSON.stringify({ seed, cache }));
      const expectedRequests = phase === "cold" ? 12 : phase === "warm" ? 6 : 9;
      const coverage = seed.coverage ?? {};
      const passed = coverage.requests === expectedRequests && transport.requests === coverage.requests &&
        transport.maxActive <= 4 && transport.unexpected === 0 && coverage.complete === true &&
        coverage.feedbackComplete === true && seed.items?.length === 2 &&
        seed.items?.every((row: Json) => row.priority === "P0") && seed.threads?.length === 2;
      runs.push({ phase, status: passed ? "pass" : "fail", elapsedMs,
        requestCount: count(transport.requests), maxConcurrentRequests: count(transport.maxActive),
        cacheHits: count(coverage.cacheHits), cacheMisses: count(coverage.refreshed),
        deepInspected: count(coverage.refreshed) });
      states.push({ items: seed.items, threads: seed.threads });
      } catch { runs.push({ phase, status: "fail", elapsedMs, reason: "missing_or_invalid_collector_output" }); break; }
    }
    const warmContentEqual = states.length === 3 && contentRevision(states[0]) === contentRevision(states[1]);
    const dirtyContentChanged = states.length === 3 && contentRevision(states[1]) !== contentRevision(states[2]);
    const passed = runs.length === 3 && runs.every((run) => run.status === "pass") &&
      warmContentEqual && dirtyContentChanged && privacyPass;
    return { status: passed ? "pass" : "fail", runs, warmContentEqual, dirtyContentChanged, privacyPass,
      requestsAvoidedWarm: runs.length >= 2 && count(runs[0].requestCount) !== null && count(runs[1].requestCount) !== null ?
        runs[0].requestCount - runs[1].requestCount : null };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function bootstrapFixture(fixture: Fixture) {
  const records = fixture.cases.map((item, index) => classifyPullRequest(
    { ...fixture.defaults, ...item.snapshot, number: index + 1 }, fixture.selfLogin));
  const threads = new Map(records.map((row) => [`${row.repo}#${row.number}`, {
    repo: row.repo, number: row.number, privacy: "public-safe", revision: contentRevision(row),
  }]));
  // These two rows deliberately have no public thread; the bootstrap must omit them.
  const hidden = ["SYNTHETIC_PRIVATE", "SYNTHETIC_UNKNOWN"].map((name) => ({
    ...records[0], repo: `fixture/${name}`, body: "SYNTHETIC_BODY", token: "SYNTHETIC_TOKEN",
  }));
  const api = { attention: { schemaVersion: 1, privacy: "public-safe", revision: contentRevision(records),
    updatedAt: fixture.defaults.updatedAt, items: [...records, ...hidden] }, threadResources: threads };
  const packet = compileAgentBootstrap(api as Parameters<typeof compileAgentBootstrap>[0]);
  const bytes = Buffer.byteLength(JSON.stringify(packet) + "\n");
  const wanted = records.filter((row) => row.priority === "P0" || row.priority === "P1").length;
  const privacyPass = !JSON.stringify(packet).includes("SYNTHETIC_");
  return { status: packet.count === Math.min(wanted, 12) && bytes <= 16384 && privacyPass ? "pass" : "fail",
    bytes, actions: packet.count, omitted: packet.omitted, fetches: 1, privacyPass };
}

/** Validate the actual local export. Do not describe this as an HTTP or complete privacy audit. */
export function evaluateExport(root: string, now = Date.now()) {
  try {
    const realRoot = fs.realpathSync(root);
    const load = (href: string) => {
      if (typeof href !== "string" || path.isAbsolute(href)) throw new Error("invalid resource path");
      const real = fs.realpathSync(path.resolve(realRoot, href));
      const relative = path.relative(realRoot, real);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("resource outside export");
      return { bytes: fs.statSync(real).size, value: readJson(real) };
    };
    const loaded = load("bootstrap.json"), packet = loaded.value;
    const attention = load("attention.json");
    const { revision, source, ...semantic } = packet;
    let pass = packet.schemaVersion === 1 && packet.privacy === "public-safe" && packet.kind === "agent-bootstrap" &&
      REVISION.test(revision) && revision === contentRevision(semantic) && loaded.bytes <= 16384 &&
      Array.isArray(packet.items) && packet.count === packet.items.length && packet.count <= 12 &&
      Number.isSafeInteger(packet.omitted) && packet.omitted >= 0 &&
      packet.actionableCached === packet.count + packet.omitted && packet.truncated === (packet.omitted > 0) &&
      attention.value.privacy === "public-safe" && Array.isArray(attention.value.items) &&
      source?.revision === attention.value.revision;
    let pointersChecked = 0;
    for (const item of packet.items ?? []) {
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(item.repo) ||
          item.repo.split("/").some((part: string) => part === "." || part === "..") ||
          !Number.isSafeInteger(item.number) || item.number < 1 ||
          item.thread?.href !== `threads/${item.repo}/${item.number}.json`) { pass = false; continue; }
      const child = load(item.thread.href).value;
      pass &&= child.privacy === "public-safe" && child.repo === item.repo && child.number === item.number &&
        REVISION.test(child.revision) && child.revision === item.thread.revision &&
        ["P0", "P1"].includes(item.priority) && typeof item.nextAction === "string" && item.nextAction.length > 0;
      pointersChecked += 1;
    }
    return { status: pass ? "pass" : "fail", measurement: "local-export", bootstrapBytes: loaded.bytes,
      attentionBytes: attention.bytes, actions: count(packet.count), omitted: count(packet.omitted), pointersChecked,
      ...age(source?.updatedAt, now) };
  } catch { return { status: "fail", measurement: "local-export", reason: "missing_or_invalid_export" }; }
}

function sourceSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 2000 });
  const value = result.stdout?.trim();
  return value && SHA.test(value) ? value : null;
}

const outcome = (value: string | undefined) => value === "success" ? "pass" : value === "failure" ? "fail" : "not_run";

async function main() {
  const args = process.argv.slice(2);
  const requireExport = args.includes("--require-export");
  const output = path.resolve(".cache/api-evals");
  fs.mkdirSync(output, { recursive: true });
  const started = performance.now();
  const report: Json = { schemaVersion: 1, privacy: "public-safe", kind: "api-eval-report", suiteVersion: 1,
    generatedAt: new Date().toISOString(), provenance: { sourceSha: sourceSha(),
      headSha: SHA.test(process.env.EVAL_HEAD_SHA ?? "") ? process.env.EVAL_HEAD_SHA : null,
      origin: process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local", node: process.versions.node,
      fixtureRevision: null, classifierVersion: PUBLIC_ATTENTION_CLASSIFIER_VERSION, cacheSchema: PUBLIC_ATTENTION_CACHE_SCHEMA },
    gates: { unitTests: outcome(process.env.EVAL_TEST_OUTCOME), build: outcome(process.env.EVAL_BUILD_OUTCOME),
      dogfood: outcome(process.env.EVAL_DOGFOOD_OUTCOME), fixtures: "not_run", collector: "not_run", bootstrap: "not_run", export: "not_run", liveAcceptance: "not_run" },
    synthetic: {}, export: null, collector: null, networkLatencyMs: null };
  try {
    if (args.some((arg) => arg !== "--require-export")) throw new Error("unknown eval argument");
    const fixture = readJson(fileURLToPath(new URL("../evals/api-v1.json", import.meta.url))) as Fixture;
    report.provenance.fixtureRevision = contentRevision(fixture);
    report.synthetic.classification = evaluateFixtures(fixture);
    report.gates.fixtures = report.synthetic.classification.passed === report.synthetic.classification.total ? "pass" : "fail";
    report.synthetic.collector = await evaluateCollector();
    report.gates.collector = report.synthetic.collector.status;
    report.synthetic.bootstrap = bootstrapFixture(fixture);
    report.gates.bootstrap = report.synthetic.bootstrap.status;
    if (requireExport) {
      report.export = evaluateExport(path.resolve("out/api/v1"));
      report.gates.export = report.export.status;
    }
    let seed: unknown = null;
    try { seed = readJson("data/attention-seed.json"); } catch { /* Explicitly unavailable, never zero. */ }
    report.collector = collectorMetrics(seed);
  } catch { report.gates.harness = "fail"; }
  report.elapsedMs = Math.round((performance.now() - started) * 100) / 100;
  report.passed = !Object.values(report.gates).includes("fail") &&
    ["fixtures", "collector", "bootstrap"].every((name) => report.gates[name] === "pass");
  const summary = ["## API evaluation (not live acceptance)", "", `Result: ${report.passed ? "PASS" : "FAIL"}`,
    `Source: ${report.provenance.sourceSha ?? "unknown"}; origin: ${report.provenance.origin}`,
    "", "| Gate | Result |", "| --- | --- |",
    ...Object.entries(report.gates).map(([key, value]) => `| ${key} | ${value} |`), "",
    `Synthetic classification: ${report.synthetic.classification?.passed ?? "unavailable"}/${report.synthetic.classification?.total ?? "unavailable"}`,
    `Synthetic collector requests (cold / warm / dirty): ${(report.synthetic.collector?.runs ?? []).map((run: Json) => run.requestCount ?? "failed").join(" / ")}`,
    `Local export bootstrap bytes: ${report.export?.bootstrapBytes ?? "not measured"}`,
    `Recorded collector cache-hit ratio: ${report.collector?.cacheHitRatio ?? "unavailable"}`,
    `Recorded inventory coverage: ${report.collector?.inventoryCoverage ?? "unavailable"}`, "",
    "No visitor telemetry. Local/synthetic timings are not deployed or ChatGPT network timings.", ""].join("\n");
  // Replace complete reports atomically; CI artifact names separate concurrent runs/attempts.
  for (const [name, text] of [["report.json", JSON.stringify(report, null, 2) + "\n"], ["summary.md", summary]]) {
    const file = path.join(output, name), temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, text); fs.renameSync(temporary, file);
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
