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
const seen = [];
let firstSearch = true;
const issue = (number, login) => ({
  id: number, number, title: "Synthetic public PR " + number, state: "open", comments: 0,
  updated_at: at, pull_request: {}, user: login === null ? null : { login },
  repository_url: "https://api.github.com/repos/fixture/repo",
  html_url: "https://github.com/" + (number === 2 ? "Fixture/Repo" : "fixture/repo") + "/pull/" + number,
});
globalThis.fetch = async input => {
  const u = new URL(String(input));
  seen.push(u.pathname);
  if (u.pathname === "/graphql") return Response.json({ data: { user: { pullRequests: {
    totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null },
    nodes: [{ number: 1, title: "Synthetic public PR 1",
      url: "https://github.com/fixture/repo/pull/1", state: "OPEN", isDraft: false,
      updatedAt: at, author: { login: "fixture-self" }, comments: { totalCount: 0 },
      reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "CLEAN",
      repository: { nameWithOwner: "fixture/repo", isPrivate: false, visibility: "PUBLIC" } }],
  } } } });
  if (u.pathname === "/search/issues") {
    const q = u.searchParams.get("q") ?? "";
    if (firstSearch) {
      firstSearch = false;
      return Response.json({ message: "temporary gateway failure" }, { status: 502 });
    }
    if (q.includes("repo:bilawalsidhu/gods-eye-view")) return Response.json({ total_count: 0, items: [] });
    if (q.includes("author:fixture-self")) return Response.json({ total_count: 1, items: [issue(1, "fixture-self")] });
    if (q.includes("involves:fixture-self")) return Response.json({ total_count: 2, items: [issue(2, "ci-worker[bot]"), issue(3, null)] });
    throw new Error("unexpected search");
  }
  if (u.pathname === "/repos/bilawalsidhu/gods-eye-view")
    return Response.json({ private: false, visibility: "public", full_name: "bilawalsidhu/gods-eye-view" });
  throw new Error("unexpected request " + u.pathname);
};
process.on("exit", () => fs.writeFileSync("requests.json", JSON.stringify(seen)));
`;

describe("public collector transport and GitHub identities", () => {
  it("preserves authenticated GraphQL, retries 502, and accepts public bot/deleted-author rows", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "collector-transport-"));
    try {
      const mockFile = path.join(root, "mock.mjs");
      const policyFile = path.join(root, "policy.json");
      fs.writeFileSync(mockFile, mock);
      fs.writeFileSync(policyFile, JSON.stringify({ schemaVersion: 1, recentDays: 60, pins: [] }));
      const result = spawnSync(process.execPath, ["--experimental-strip-types", "--import", mockFile, collector], {
        cwd: root, encoding: "utf8", timeout: 15000,
        env: { ...process.env, GITHUB_TOKEN: "fixture-test-token", GH_TOKEN: "", GH_ARCHIVE_TOKEN: "",
          GITHUB_PUBLIC_LOGIN: "fixture-self", PUBLIC_ATTENTION_DEEP_LIMIT: "0",
          PUBLIC_ATTENTION_SEARCH_INTERVAL_MS: "0", PUBLIC_ATTENTION_POLICY: policyFile,
          PUBLIC_ATTENTION_CACHE: path.join(root, "cache.json") },
      });
      assert.equal(result.status, 0, result.stderr);
      const seed = JSON.parse(fs.readFileSync(path.join(root, "data/attention-seed.json"), "utf8"));
      const requested = JSON.parse(fs.readFileSync(path.join(root, "requests.json"), "utf8"));
      assert.equal(requested.length, 5, "a transient HTTP 502 must consume one extra request");
      assert.equal(seed.coverage.requests, 5);
      assert.equal(seed.coverage.authored.complete, true);
      assert.equal(seed.coverage.recent.complete, true);
      assert.equal(seed.coverage.complete, true);
      assert.equal(seed.items.length, 3, "all public rows must be materialized");
      assert.equal(seed.coverage.feedbackComplete, false, "unread feedback remains unverified");
      assert.equal(JSON.stringify(seed).includes("temporary gateway failure"), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
