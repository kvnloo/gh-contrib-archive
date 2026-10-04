import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, it } from "node:test";
import {
  openAttentionDb,
  readAttentionRecords,
  replaceAttentionRecords,
} from "../lib/attention-db.ts";
import type { AttentionRecord } from "../lib/attention.ts";

describe("attention database evidence", () => {
  it("round-trips latest external actor and event metadata", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "attention-db-"));
    const db = openAttentionDb(path.join(root, "attention.db"));
    const record: AttentionRecord = {
      repo: "example/repo",
      repoVisibility: "public",
      number: 7,
      title: "PR 7",
      url: "https://github.com/example/repo/pull/7",
      priority: "P0",
      blocker: "changes_requested",
      nextAction: "address requested changes",
      updatedAt: "2026-10-03T20:00:00Z",
      lastExternalAt: "2026-10-03T20:00:00Z",
      latestExternalActor: "maintainer",
      latestExternalKind: "review",
      latestExternalReviewState: "CHANGES_REQUESTED",
      lastSelfAt: null,
      ciState: "passing",
      reviewDecision: "CHANGES_REQUESTED",
      mergeState: "CLEAN",
    };

    try {
      replaceAttentionRecords(db, [record], "2026-10-03T20:05:00Z");
      assert.deepEqual(readAttentionRecords(db, 1)[0], record);
    } finally {
      db.close();
    }
  });
});
