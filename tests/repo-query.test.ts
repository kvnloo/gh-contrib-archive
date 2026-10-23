import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { queryRepo } from "../lib/repo-query.ts";
import { writePublicApi } from "../lib/public-api.ts";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(new URL("../lib/schema.sql", import.meta.url), "utf8"));
  db.prepare("INSERT INTO meta VALUES ('login', 'kvnloo')").run();
  return db;
}

function add(db: DatabaseSync, id: string, type: string, state: string | null = null, repo: string | null = "Owner/Project", url = `https://github.com/Owner/Project/issues/1#${id}`, extra: string | null = null) {
  db.prepare(`INSERT INTO contributions
    (id, type, url, html_url, repo, state, created_at, ingested_at, extra_json)
    VALUES (?, ?, ?, ?, ?, ?, '2026-10-01T00:00:00Z', '2026-10-02 00:00:00', ?)`)
    .run(id, type, url, url, repo, state, extra);
}

describe("repository contribution query", () => {
  it("counts categories case-insensitively without adding commits to activity rows", () => {
    const db = fixture();
    try {
      add(db, "merged", "pull_request", "MERGED");
      add(db, "closed", "pull_request", "CLOSED");
      add(db, "open", "pull_request", "OPEN");
      add(db, "unknown", "pull_request");
      add(db, "issue", "issue", "CLOSED");
      add(db, "issue-comment", "comment");
      add(db, "pr-comment", "comment", null, "Owner/Project", "https://github.com/Owner/Project/pull/2#issuecomment-1");
      add(db, "unclassified-comment", "comment", null, "Owner/Project", "https://example.com/comment/1");
      add(db, "review", "review", "APPROVED");
      add(db, "inline", "review_comment");
      add(db, "discussion", "discussion");
      add(db, "reply", "discussion_comment");
      add(db, "future", "future_type");
      add(db, "other-repo", "issue", null, "Owner/Elsewhere");
      add(db, "redacted", "issue", null, null, "redacted://private/1");
      db.exec(`INSERT INTO commit_buckets VALUES
        ('2025:repo', 2025, 'owner/project', 'public', 3, NULL),
        ('2026:repo', 2026, 'Owner/Project', 'public', 4, NULL),
        ('private:2026', 2026, NULL, 'private', 100, NULL)`);
      db.exec("INSERT INTO flags(contribution_id,code,severity,detail) VALUES ('issue','machine_title','warn','heuristic')");
      const result = queryRepo(db, "OWNER/PROJECT");
      assert.equal(result.activity_rows, 13);
      assert.deepEqual(result.counts, {
        pull_requests: { total: 4, merged: 1, open: 1, closed_unmerged: 1, state_unknown: 1, landed_elsewhere: null, closed_unmerged_landing_unknown: 1 },
        issues: 1,
        issue_comments: 1,
        pull_request_comments: 1,
        comments_parent_unknown: 1,
        review_bodies: 1,
        review_comments: 1,
        discussions: 1,
        discussion_comments: 1,
        other_activity: 1,
        github_commit_contributions: 7,
      });
      assert.deepEqual(result.commit_years, [2025, 2026]);
      assert.deepEqual(result.archive_flags, [{ code: "machine_title", severity: "warn", count: 1 }]);
      assert.equal(result.caveats.some((item) => item.code === "SALVAGE_UNKNOWN"), true);
      assert.equal(result.caveats.some((item) => item.code === "REDACTED_REPOS_UNATTRIBUTABLE"), true);
    } finally { db.close(); }
  });

  it("never infers landing from titles, prose, or unverified extra_json", () => {
    const db = fixture();
    try {
      add(db, "closed", "pull_request", "CLOSED", "Owner/Project", undefined, JSON.stringify({ landedElsewhere: true, commits: ["same-sha"] }));
      add(db, "merged", "pull_request", "MERGED", "Owner/Project", undefined, JSON.stringify({ commits: ["same-sha"] }));
      const result = queryRepo(db, "owner/project");
      assert.equal(result.counts.pull_requests.landed_elsewhere, null);
      assert.equal(result.counts.pull_requests.closed_unmerged_landing_unknown, 1);
    } finally { db.close(); }
  });

  it("distinguishes no bucket coverage from a measured zero and an absent repo", () => {
    const db = fixture();
    try {
      const absent = queryRepo(db, "owner/missing");
      assert.equal(absent.activity_rows, 0);
      assert.equal(absent.counts.github_commit_contributions, null);
      assert.equal(absent.counts.pull_requests.landed_elsewhere, 0);
      assert.equal(absent.caveats.some((item) => item.code === "NO_MATCHING_DATA"), true);
      db.exec("INSERT INTO commit_buckets VALUES ('zero',2026,'Owner/Project','public',0,NULL)");
      assert.equal(queryRepo(db, "owner/project").counts.github_commit_contributions, 0);
    } finally { db.close(); }
  });

  it("rejects malformed repository names rather than treating them as SQL", () => {
    const db = fixture();
    try {
      for (const repo of ["owner", "owner/project/extra", "owner/project' OR 1=1", "https://github.com/owner/project"]) {
        assert.throws(() => queryRepo(db, repo), /owner\/name/);
      }
    } finally { db.close(); }
  });

  it("CLI reads an explicit fixture DB and does not create or mutate databases", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-query-"));
    const dbPath = path.join(dir, "github.db");
    const db = new DatabaseSync(dbPath);
    db.exec(fs.readFileSync(new URL("../lib/schema.sql", import.meta.url), "utf8"));
    add(db, "one", "issue");
    db.close();
    const cli = new URL("../scripts/query-repo.ts", import.meta.url);
    const invoke = (args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", cli.pathname, ...args], { encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" } });
    try {
      const before = fs.readFileSync(dbPath);
      const run = invoke(["--repo", "owner/project", "--db", dbPath]);
      assert.equal(run.status, 0, run.stderr);
      assert.equal(JSON.parse(run.stdout).counts.issues, 1);
      assert.deepEqual(fs.readFileSync(dbPath), before);
      const missing = path.join(dir, "missing.db");
      const failure = invoke(["--repo", "owner/project", "--db", missing]);
      assert.equal(failure.status, 1);
      assert.match(failure.stderr, /database not found/i);
      assert.equal(fs.existsSync(missing), false);
      assert.equal(invoke(["--repo", "owner/project", "--unknown"]).status, 1);
      assert.equal(invoke([]).status, 1);
    } finally { fs.rmSync(dir, { recursive: true }); }
  });
});

describe("public repository contribution summaries", () => {
  it("exports small, discoverable, deterministic summaries without private/unknown rows", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-summary-"));
    const dbPath = path.join(root, "public.db");
    const db = new DatabaseSync(dbPath);
    db.exec(fs.readFileSync(new URL("../lib/schema.sql", import.meta.url), "utf8"));
    try {
      add(db, "public", "pull_request", "CLOSED");
      add(db, "hidden-same-repo", "issue");
      add(db, "private", "issue", null, "secret/private");
      add(db, "unknown", "issue", null, "secret/unknown");
      db.exec("UPDATE contributions SET visibility = 'public' WHERE id = 'public'");
      db.exec("UPDATE contributions SET visibility = 'private' WHERE id IN ('private', 'hidden-same-repo')");
      db.exec(`INSERT INTO commit_buckets VALUES
        ('visible',2026,'Owner/Project','public',7,NULL),
        ('hidden',2026,'Owner/Project','private',900,NULL),
        ('only',2026,'Owner/CommitOnly','public',3,NULL),
        ('private-only',2026,'secret/commit-only','private',99,NULL)`);
      const output = path.join(root, "output");
      const run = () => writePublicApi(dbPath, path.join(root, "attention.db"), output);
      const first = run();
      assert.equal(first.index.endpoints.repoSummary, "repos/{owner}/{repo}/summary.json");
      const row = first.repos.repos.find((row) => row.repo === "Owner/Project")!;
      const filename = path.join(output, "api/v1", row.summary.href);
      const payload = fs.readFileSync(filename, "utf8");
      assert.ok(Buffer.byteLength(payload) < 50_000);
      assert.equal(row.summary.bytes, Buffer.byteLength(payload));
      const summary = JSON.parse(payload);
      assert.equal(summary.counts.issues, 0);
      assert.equal(summary.activityRows, 1);
      assert.equal(summary.counts.github_commit_contributions, 7);
      assert.equal(summary.counts.pull_requests.landed_elsewhere, null);
      assert.equal(summary.coverage.complete, false);
      assert.equal(typeof summary.freshness.archiveUpdatedAt, "string");
      assert.equal(first.repoSummaries.get("Owner/CommitOnly")?.counts.github_commit_contributions, 3);
      assert.equal(JSON.stringify([...first.repoSummaries]).includes("secret/"), false);
      assert.equal(payload.includes("hidden-same-repo"), false);
      assert.equal(Object.hasOwn(summary, "excerpt"), false);
      assert.equal(Object.hasOwn(summary, "contributions"), false);
      db.exec("UPDATE contributions SET ingested_at = '2026-10-22 12:00:00'");
      const second = run();
      assert.equal(second.repoSummaries.get("Owner/Project")?.revision, summary.revision);
      db.exec("UPDATE contributions SET state = 'MERGED' WHERE id = 'public'");
      const third = run();
      assert.notEqual(third.repoSummaries.get("Owner/Project")?.revision, summary.revision);
      assert.notEqual(third.repos.revision, second.repos.revision);
    } finally {
      db.close();
      fs.rmSync(root, { recursive: true });
    }
  });
});
