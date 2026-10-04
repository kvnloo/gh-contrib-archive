import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { openDb } from "../lib/db.ts";
import {
  replaceCommitYearIfChanged,
  upsertContribution,
} from "../lib/incremental-storage.ts";

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "ghca-storage-"));
  const dbPath = path.join(dir, "public.db");
  const db = openDb(dbPath);
  return {
    db,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("unchanged incremental rows do not churn ingested_at", () => {
  const f = fixture();
  try {
    const row = {
      id: "PR_test",
      type: "pull_request",
      url: "https://github.com/example/repo/pull/1",
      repo: "example/repo",
      number: 1,
      title: "stable title",
      body: "stable body",
      state: "OPEN",
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-02T00:00:00Z",
      isPrivate: false,
    };

    assert.equal(upsertContribution(f.db, row), true);
    f.db
      .prepare("UPDATE contributions SET ingested_at = ? WHERE id = ?")
      .run("2000-01-01 00:00:00", row.id);

    assert.equal(upsertContribution(f.db, row), false);
    const unchanged = f.db
      .prepare("SELECT title, ingested_at FROM contributions WHERE id = ?")
      .get(row.id) as { title: string; ingested_at: string };
    assert.equal(unchanged.title, "stable title");
    assert.equal(unchanged.ingested_at, "2000-01-01 00:00:00");

    assert.equal(
      upsertContribution(f.db, { ...row, title: "changed title" }),
      true,
    );
    const changed = f.db
      .prepare("SELECT title, ingested_at FROM contributions WHERE id = ?")
      .get(row.id) as { title: string; ingested_at: string };
    assert.equal(changed.title, "changed title");
    assert.notEqual(changed.ingested_at, "2000-01-01 00:00:00");
  } finally {
    f.cleanup();
  }
});

test("unchanged yearly commit buckets are not rewritten", () => {
  const f = fixture();
  try {
    const rows = [
      { repo: "example/a", count: 3 },
      { repo: "example/b", count: 7 },
    ];
    assert.equal(
      replaceCommitYearIfChanged(f.db, 2026, rows, 2, "alice"),
      true,
    );
    const before = f.db
      .prepare(
        "SELECT id, year, repo, visibility, commit_count, html_url FROM commit_buckets WHERE year = 2026 ORDER BY id",
      )
      .all();

    assert.equal(
      replaceCommitYearIfChanged(f.db, 2026, rows, 2, "alice"),
      false,
    );
    const after = f.db
      .prepare(
        "SELECT id, year, repo, visibility, commit_count, html_url FROM commit_buckets WHERE year = 2026 ORDER BY id",
      )
      .all();
    assert.deepEqual(after, before);
    assert.ok(
      after.some(
        (row: any) =>
          row.repo === "example/a" &&
          row.html_url ===
            "https://github.com/example/a/commits?author=alice",
      ),
    );

    assert.equal(
      replaceCommitYearIfChanged(
        f.db,
        2026,
        [
          { repo: "example/a", count: 4 },
          { repo: "example/b", count: 7 },
        ],
        2,
        "alice",
      ),
      true,
    );
  } finally {
    f.cleanup();
  }
});
