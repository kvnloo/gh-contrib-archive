import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const collector = fileURLToPath(new URL("../scripts/public-attention-sync.ts", import.meta.url));

const mock = `
import fs from "node:fs";
const at = "2026-10-10T00:00:00Z";
const requests = [];
const prs = [1, 2].map(number => ({
  id: number, number, repository_url: "https://api.github.com/repos/fixture/repo",
  html_url: "https://github.com/fixture/repo/pull/" + number,
  title: "Synthetic PR " + number, user: { login: "fixture-self" },
  state: "open", comments: 1, updated_at: at, pull_request: {},
}));
globalThis.fetch = async input => {
  const u = new URL(String(input));
  requests.push(u.pathname);
  if (u.pathname === "/repos/bilawalsidhu/gods-eye-view")
    return Response.json({ private: false, visibility: "public", full_name: "bilawalsidhu/gods-eye-view" });
  if (u.pathname === "/search/issues") {
    const q = u.searchParams.get("q") ?? "";
    return Response.json(q.includes("repo:bilawalsidhu/gods-eye-view")
      ? { total_count: 0, items: [] } : { total_count: 2, items: prs });
  }
  if (u.pathname === "/repos/fixture/repo/issues/1/comments")
    return Response.json({ message: "transient synthetic outage" }, { status: 503 });
  if (u.pathname === "/repos/fixture/repo/issues/2/comments")
    return Response.json([{ id: 102, user: { login: "reviewer", type: "User" },
      body: "Please check the fixture. RAW_BODY_NOT_FOR_CACHE",
      created_at: at, html_url: "https://github.com/fixture/repo/pull/2#issuecomment-102" }]);
  if (/^\\/repos\\/fixture\\/repo\\/pulls\\/2\\/(reviews|comments)$/.test(u.pathname))
    return Response.json([]);
  throw new Error("unexpected synthetic request " + u.pathname);
};
process.on("exit", () => fs.writeFileSync("requests.json", JSON.stringify(requests)));
`;

describe("covered-inbox checkpoint convergence", () => {
  it("rotates past failed reads and reuses unchanged two-day feedback safely", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "attention-convergence-"));
    try {
      const mockFile = path.join(root, "mock.mjs");
      const policyFile = path.join(root, "policy.json");
      const cacheFile = path.join(root, "cache.json");
      fs.writeFileSync(mockFile, mock);
      fs.writeFileSync(policyFile, JSON.stringify({ schemaVersion: 1, recentDays: 60, pins: [] }));
      const run = () => {
        const result = spawnSync(process.execPath, ["--experimental-strip-types", "--import", mockFile, collector], {
          cwd: root, encoding: "utf8", timeout: 15000,
          env: { ...process.env, GITHUB_TOKEN: "", GH_TOKEN: "", GH_ARCHIVE_TOKEN: "",
            GITHUB_PUBLIC_LOGIN: "fixture-self", PUBLIC_ATTENTION_DEEP_LIMIT: "1",
            PUBLIC_ATTENTION_SEARCH_INTERVAL_MS: "0", PUBLIC_ATTENTION_CACHE: cacheFile,
            PUBLIC_ATTENTION_POLICY: policyFile },
        });
        assert.equal(result.status, 0, result.stderr);
        const seed = JSON.parse(fs.readFileSync(path.join(root, "data/attention-seed.json"), "utf8"));
        const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
        const requests = JSON.parse(fs.readFileSync(path.join(root, "requests.json"), "utf8"));
        assert.equal(JSON.stringify({ seed, cache }).includes("RAW_BODY_NOT_FOR_CACHE"), false);
        return { seed, cache, requests };
      };

      const first = run();
      assert.equal(first.cache.items["fixture/repo#1"].complete, false);
      assert.equal(first.cache.items["fixture/repo#1"].record, null, "failed cache must retain only a retry marker");
      assert.equal(first.seed.coverage.feedbackComplete, false);

      const second = run();
      assert.equal(second.cache.items["fixture/repo#2"].complete, true,
        "a persistently failing first PR must not starve the next PR");
      assert.equal(second.cache.items["fixture/repo#1"].complete, false);
      assert.equal(second.seed.coverage.feedbackComplete, false, "failure must never be presented as full coverage");
      assert.equal(second.seed.coverage.threads.find((thread: { number: number }) => thread.number === 2).feedbackComplete, true);

      // A two-day-old successful inspection is still valid when GitHub's
      // source updatedAt has not moved. This lets bounded hourly sweeps converge.
      const onDisk = second.cache;
      onDisk.items["fixture/repo#2"].inspectedAt = new Date(Date.now() - 2 * 86400_000).toISOString();
      fs.writeFileSync(cacheFile, JSON.stringify(onDisk));
      const third = run();
      assert.equal(third.seed.coverage.cacheHits, 1);
      assert.equal(third.requests.includes("/repos/fixture/repo/issues/2/comments"), false);
      assert.equal(third.seed.coverage.feedbackComplete, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
