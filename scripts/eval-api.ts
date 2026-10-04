import fs from "node:fs";
import path from "node:path";
import { collectAggregateMetrics, evaluateApiFixture, type EvalFixture } from "../lib/api-evals.ts";

const outputRoot = path.resolve(process.argv[2] ?? "out");
const fixturePath = path.resolve(process.argv[3] ?? "fixtures/evals/agent-read-v1.json");
const artifactRoot = path.resolve(process.argv[4] ?? ".artifacts");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as EvalFixture;
const report = evaluateApiFixture(outputRoot, fixture);
let attentionSeed: unknown = {};
try { attentionSeed = JSON.parse(fs.readFileSync(path.resolve("data/attention-seed.json"), "utf8")); } catch {}
const metrics = collectAggregateMetrics(outputRoot, attentionSeed, report, process.env.GITHUB_SHA ?? null);
fs.mkdirSync(artifactRoot, { recursive: true });
fs.writeFileSync(path.join(artifactRoot, "api-eval.json"), JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(path.join(artifactRoot, "api-metrics.json"), JSON.stringify(metrics, null, 2) + "\n");
const summary = [
  "## API evals",
  "",
  `- contracts: ${report.passed}/${report.total} passed`,
  `- API JSON: ${metrics.reader.jsonFiles} files / ${metrics.reader.jsonBytes} bytes`,
  `- bootstrap: ${metrics.reader.bootstrapBytes ?? "n/a"} bytes`,
  `- collector requests: ${metrics.collector.requestCount ?? "n/a"}`,
  `- cache reuse: ${metrics.collector.cacheReuseRatio == null ? "n/a" : (metrics.collector.cacheReuseRatio * 100).toFixed(1) + "%"}`,
  "",
].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary.trim());
if (report.failed > 0) process.exitCode = 1;
