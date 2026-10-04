import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { evaluateCollectorBudget, type EvalFixture } from "../lib/api-evals.ts";

const collector = fileURLToPath(new URL("../scripts/public-attention-sync.ts", import.meta.url));
const fixtureFile = fileURLToPath(new URL("../fixtures/evals/agent-read-v1.json", import.meta.url));

const mock = `
import fs from "node:fs";
const baseAt = "2026-01-01T00:00:00Z";
const changedAt = process.env.SYNTHETIC_CHANGED === "1" ? "2026-01-01T00:01:00Z" : baseAt;
const requests = [];
const prs = [1, 2].map(number => ({
  id: number, number, repository_url: "https://api.github.com/repos/example/repo",
  html_url: "https://github.com/example/repo/pull/" + number,
  title: "Synthetic PR " + number, user: { login: "example-author" },
  state: "open", comments: 1, updated_at: number === 1 ? changedAt : baseAt,
}));
globalThis.fetch = async url => {
  requests.push(String(url));
  if (String(url).includes("/search/issues?")) return Response.json({ total_count: 2, items: prs });
  if (String(url).includes("/comments?")) {
    const number = Number(String(url).match(/issues\\/(\\d+)/)[1]);
    return Response.json([{ id: number, user: { login: "example-reviewer" },
      body: "Synthetic feedback body that must never enter eval analytics",
      created_at: number === 1 ? changedAt : baseAt,
      html_url: "https://github.com/example/repo/pull/" + number + "#issuecomment-" + number,
    }]);
  }
  if (String(url).includes("/reviews?")) return Response.json([]);
  throw new Error("unexpected synthetic request");
};
process.on("exit", () => fs.writeFileSync("requests.json", JSON.stringify(requests)));
`;

describe("collector request-budget eval", () => {
  it("measures cold, warm, and one-changed request budgets on the actual collector", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "collector-budget-"));
    try {
      const fixture = JSON.parse(fs.readFileSync(fixtureFile, "utf8")) as EvalFixture;
      const mockFile = path.join(root, "mock.mjs");
      fs.writeFileSync(mockFile, mock);
      const cache = path.join(root, "cache.json");
      const run = (changed: boolean) => {
        const result = spawnSync(process.execPath, ["--experimental-strip-types", "--import", mockFile, collector], {
          cwd: root, encoding: "utf8", timeout: 15000,
          env: { ...process.env, GITHUB_PUBLIC_LOGIN: "example-author", PUBLIC_ATTENTION_CONCURRENCY: "2",
            PUBLIC_ATTENTION_DEEP_LIMIT: "2", PUBLIC_ATTENTION_CACHE: cache,
            SYNTHETIC_CHANGED: changed ? "1" : "0" },
        });
        assert.equal(result.status, 0, result.stderr);
        const seed = JSON.parse(fs.readFileSync(path.join(root, "data", "attention-seed.json"), "utf8"));
        const requests = JSON.parse(fs.readFileSync(path.join(root, "requests.json"), "utf8"));
        assert.equal(seed.requestCount, requests.length);
        assert.equal(JSON.stringify(seed).includes("Synthetic feedback body"), false);
        return { requestCount: seed.requestCount, cacheHits: seed.cacheHits };
      };

      const cold = run(false);
      assert.deepEqual(cold, { requestCount: 5, cacheHits: 0 });
      assert.equal(evaluateCollectorBudget(fixture, "cold", cold).ok, true);

      const warm = run(false);
      assert.deepEqual(warm, { requestCount: 1, cacheHits: 2 });
      assert.equal(evaluateCollectorBudget(fixture, "warm", warm).ok, true);

      const oneChanged = run(true);
      assert.deepEqual(oneChanged, { requestCount: 3, cacheHits: 1 });
      assert.equal(evaluateCollectorBudget(fixture, "oneChanged", oneChanged).ok, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
