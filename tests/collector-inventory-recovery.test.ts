import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const collector = fileURLToPath(new URL("../scripts/public-attention-sync.ts", import.meta.url));

// Three authored pages (cursor a -> b -> end). The first 100-row request
// persistently 502s; smaller pages work. One search returns a 200 HTML body
// once (observed on hosted runners), and one pin is a renamed repository.
const mock = `
import fs from "node:fs";
const at = "2026-10-10T00:00:00Z";
const seen = [];
let htmlOnce = true;
const node = n => ({ number: n, title: "Synthetic public PR " + n, url: "https://github.com/fixture/repo/pull/" + n,
  state: "OPEN", isDraft: false, updatedAt: at, author: { login: "fixture-self" }, comments: { totalCount: 0 },
  reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "CLEAN",
  repository: { nameWithOwner: "fixture/repo", isPrivate: false, visibility: "PUBLIC" } });
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(String(input));
  if (u.pathname === "/graphql") {
    const v = JSON.parse(init.body).variables;
    seen.push("graphql:" + v.pageSize);
    if (v.after === null && v.pageSize > 50) return new Response("<html>502 Bad Gateway</html>", { status: 502 });
    const page = v.after === null ? 0 : v.after === "a" ? 1 : 2;
    return Response.json({ data: { user: { pullRequests: { totalCount: 3,
      pageInfo: { hasNextPage: page < 2, endCursor: page === 0 ? "a" : page === 1 ? "b" : null },
      nodes: [node(page + 1)] } } } });
  }
  seen.push(u.pathname);
  if (u.pathname === "/search/issues") {
    if (htmlOnce) { htmlOnce = false; return new Response("<html>unicorn</html>", { status: 200, headers: { "content-type": "text/html" } }); }
    return Response.json({ total_count: 0, items: [] });
  }
  if (u.pathname === "/repos/old-owner/renamed")
    return new Response("", { status: 301, headers: { location: "https://api.github.com/repositories/1" } });
  if (u.pathname === "/repos/bilawalsidhu/gods-eye-view")
    return Response.json({ private: false, visibility: "public", full_name: "bilawalsidhu/gods-eye-view" });
  throw new Error("unexpected request " + u.pathname);
};
process.on("exit", () => fs.writeFileSync("requests.json", JSON.stringify(seen)));
`;

function run(pins: string[], source = mock) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "collector-inventory-recovery-"));
  const mockFile = path.join(root, "mock.mjs");
  const policyFile = path.join(root, "policy.json");
  fs.writeFileSync(mockFile, source);
  fs.writeFileSync(policyFile, JSON.stringify({ schemaVersion: 1, recentDays: 60, pins }));
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--import", mockFile, collector], {
    cwd: root, encoding: "utf8", timeout: 30_000,
    env: { ...process.env, GITHUB_TOKEN: "fixture-test-token", GH_TOKEN: "", GH_ARCHIVE_TOKEN: "",
      GITHUB_PUBLIC_LOGIN: "fixture-self", PUBLIC_ATTENTION_DEEP_LIMIT: "0",
      PUBLIC_ATTENTION_SEARCH_INTERVAL_MS: "0", PUBLIC_ATTENTION_POLICY: policyFile,
      PUBLIC_ATTENTION_CACHE: path.join(root, "cache.json") },
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    return {
      seed: JSON.parse(fs.readFileSync(path.join(root, "data/attention-seed.json"), "utf8")),
      requests: JSON.parse(fs.readFileSync(path.join(root, "requests.json"), "utf8")),
      stdout: result.stdout,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Authored walk whose totalCount changes between pages on the first attempt
// only (a PR opened mid-scan), then is stable on the restart.
const churnMock = `
import fs from "node:fs";
const at = "2026-10-10T00:00:00Z";
const seen = [];
let calls = 0;
const node = n => ({ number: n, title: "Synthetic public PR " + n, url: "https://github.com/fixture/repo/pull/" + n,
  state: "OPEN", isDraft: false, updatedAt: at, author: { login: "fixture-self" }, comments: { totalCount: 0 },
  reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "CLEAN",
  repository: { nameWithOwner: "fixture/repo", isPrivate: false, visibility: "PUBLIC" } });
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(String(input));
  seen.push(u.pathname);
  if (u.pathname === "/graphql") {
    const v = JSON.parse(init.body).variables;
    calls++;
    const page = v.after === null ? 0 : 1;
    const total = calls === 2 ? 3 : 2;
    return Response.json({ data: { user: { pullRequests: { totalCount: total,
      pageInfo: { hasNextPage: page === 0, endCursor: page === 0 ? "a" : null }, nodes: [node(page + 1)] } } } });
  }
  if (u.pathname === "/search/issues") return Response.json({ total_count: 0, items: [] });
  if (u.pathname === "/repos/bilawalsidhu/gods-eye-view")
    return Response.json({ private: false, visibility: "public", full_name: "bilawalsidhu/gods-eye-view" });
  throw new Error("unexpected request " + u.pathname);
};
process.on("exit", () => fs.writeFileSync("requests.json", JSON.stringify(seen)));
`;

describe("covered inventory recovers from transient and stale-pin failures", () => {
  it("restarts the authored walk when totalCount changes mid-scan, keeping the stable-count rule", () => {
    const { seed, requests, stdout } = run([], churnMock);
    assert.equal(requests.filter((r: string) => r === "/graphql").length, 4);
    assert.equal(seed.coverage.authored.complete, true, JSON.stringify(seed.coverage.authored));
    assert.equal(seed.coverage.authored.attempts, 2);
    assert.equal(seed.coverage.authored.reported, 2);
    assert.match(stdout, /"authored":\{"complete":true,"reason":null,"reported":2,"attempts":2\}/);
  });

  it("restores the authored page size after a downshift instead of paying for small pages forever", () => {
    const { seed, requests } = run([]);
    assert.deepEqual(requests.filter((r: string) => r.startsWith("graphql:")),
      ["graphql:100", "graphql:100", "graphql:100", "graphql:50", "graphql:100", "graphql:100"]);
    assert.equal(seed.coverage.authored.complete, true);
  });

  it("retries a 200 response whose body is not JSON instead of failing the inventory", () => {
    const { seed } = run([]);
    assert.equal(seed.coverage.recent.complete, true, JSON.stringify(seed.coverage.recent.partitions));
    assert.equal(seed.coverage.complete, true);
  });

  it("names the reason for an unavailable pin so a renamed repository is diagnosable", () => {
    const { seed, stdout } = run(["old-owner/renamed"]);
    assert.equal(seed.coverage.complete, false);
    assert.equal(seed.coverage.unavailablePins, 1);
    assert.deepEqual(seed.coverage.unavailablePinReasons, [{ repo: "old-owner/renamed", reason: "http_301" }]);
    assert.match(stdout, /"unavailablePinReasons":\[\{"repo":"old-owner\/renamed","reason":"http_301"\}\]/);
  });
});
