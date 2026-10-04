import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const collector = fileURLToPath(new URL("../scripts/public-attention-sync.ts", import.meta.url));

// Two synthetic public PRs exercise the actual collector, never the network.
const mock = `
import fs from "node:fs";
const at = "2026-01-01T00:00:00Z";
const requests = [];
const prs = [1, 2].map(number => ({
  id: number, number, repository_url: "https://api.github.com/repos/example/repo",
  html_url: "https://github.com/example/repo/pull/" + number,
  title: "Synthetic PR " + number, user: { login: "example-author" },
  state: "open", comments: 1, updated_at: at,
}));
globalThis.fetch = async url => {
  requests.push(String(url));
  if (String(url).includes("/search/issues?")) return Response.json({ total_count: Number(process.env.MOCK_TOTAL ?? prs.length), items: prs });
  if (String(url).includes("/comments?")) {
    const number = Number(String(url).match(/issues\\/(\\d+)/)[1]);
    return Response.json([{ id: number, user: { login: "example-reviewer" },
      body: "Please run the regression test. RAW_BODY_DO_NOT_PERSIST",
      created_at: at, html_url: "https://github.com/example/repo/pull/" + number + "#issuecomment-" + number,
    }]);
  }
  if (String(url).includes("/reviews?")) return Response.json([]);
  throw new Error("unexpected synthetic request");
};
process.on("exit", () => fs.writeFileSync("requests.json", JSON.stringify(requests)));
`;

describe("collector event/cache integration", () => {
  it("retains public events on warm reuse, invalidates legacy caches, and discards raw bodies", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "collector-events-"));
    try {
      const mockFile = path.join(root, "mock.mjs");
      fs.writeFileSync(mockFile, mock);
      const run = (mockTotal?: number) => {
        const result = spawnSync(process.execPath, ["--experimental-strip-types", "--import", mockFile, collector], {
          cwd: root, encoding: "utf8", timeout: 15000,
          env: { ...process.env, GITHUB_PUBLIC_LOGIN: "example-author", PUBLIC_ATTENTION_CONCURRENCY: "2",
            PUBLIC_ATTENTION_DEEP_LIMIT: "2", PUBLIC_ATTENTION_CACHE: path.join(root, "cache.json"),
            ...(mockTotal == null ? {} : { MOCK_TOTAL: String(mockTotal) }) },
        });
        assert.equal(result.status, 0, result.stderr);
        const output = fs.readFileSync(path.join(root, "data", "attention-seed.json"), "utf8");
        const cached = fs.readFileSync(path.join(root, "cache.json"), "utf8");
        assert.equal(output.includes("RAW_BODY_DO_NOT_PERSIST"), false);
        assert.equal(cached.includes("RAW_BODY_DO_NOT_PERSIST"), false);
        return { seed: JSON.parse(output), requests: JSON.parse(fs.readFileSync(path.join(root, "requests.json"), "utf8")) };
      };
      const cold = run();
      assert.match(decodeURIComponent(cold.requests[0]), /involves:example-author/);
      assert.equal(cold.seed.collectionScope, "open-prs-involving-login");
      assert.equal(cold.seed.coverageComplete, true);
      assert.equal(cold.requests.length, 5);
      assert.equal(cold.seed.requestCount, 5);
      assert.equal(cold.seed.threads?.length, 2, "cold inspection must emit both public thread snapshots");
      assert.deepEqual(cold.seed.items.map((row: { priority: string }) => row.priority), ["P0", "P0"]);
      const warm = run();
      assert.equal(warm.requests.length, 1);
      assert.equal(warm.seed.requestCount, 1);
      assert.equal(warm.seed.cacheHits, 2);
      assert.deepEqual(warm.seed.items, cold.seed.items);
      assert.deepEqual(warm.seed.threads, cold.seed.threads, "warm reuse must not erase event context");
      const partial = run(5);
      assert.equal(partial.seed.coverageComplete, false, "search truncation must be explicit");
      assert.equal(partial.seed.totalOpenReportedBySearch, 5);

      // Old classifier-only caches cannot satisfy the event-context contract.
      const legacy = JSON.parse(fs.readFileSync(path.join(root, "cache.json"), "utf8"));
      legacy.schemaVersion = 1;
      for (const entry of Object.values(legacy.items) as Record<string, unknown>[]) delete entry.events;
      fs.writeFileSync(path.join(root, "cache.json"), JSON.stringify(legacy));
      const backfilled = run();
      assert.equal(backfilled.requests.length, 5);
      assert.deepEqual(backfilled.seed.threads, cold.seed.threads);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
