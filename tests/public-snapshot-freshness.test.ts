import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { openDb } from "../lib/db.ts";
import { compilePublicSnapshot } from "../lib/public-snapshot.ts";

test("completed sync marker owns lastCheckedAt without rewriting contribution rows", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ghca-freshness-"));
  const dbPath = path.join(dir, "public.db");
  const db = openDb(dbPath);
  try {
    db.prepare(
      `INSERT INTO contributions (
        id, github_node_id, type, url, html_url, repo, number, title, excerpt,
        body_chars, state, visibility, created_at, updated_at, ingested_at, extra_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'public', ?, ?, ?, NULL)`,
    ).run(
      "PR_test",
      "PR_test",
      "pull_request",
      "https://github.com/example/repo/pull/1",
      "https://github.com/example/repo/pull/1",
      "example/repo",
      1,
      "Example",
      "Example",
      7,
      "OPEN",
      "2026-10-01T00:00:00Z",
      "2026-10-02T00:00:00Z",
      "2000-01-01 00:00:00",
    );
    db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)").run(
      "finished_at",
      "2026-10-04T05:30:00Z",
    );
  } finally {
    db.close();
  }

  try {
    const snapshot = compilePublicSnapshot(dbPath);
    assert.equal(snapshot.manifest.lastCheckedAt, "2026-10-04T05:30:00Z");
    assert.equal(snapshot.archive.generatedAt, "2026-10-04T05:30:00Z");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
