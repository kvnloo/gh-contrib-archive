import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  canReuseAttention,
  readAttentionCache,
  writeAttentionCache,
  type AttentionCacheEntry,
} from "../lib/public-attention-cache.ts";

const record = {
  repo: "example/repo",
  repoVisibility: "public" as const,
  number: 7,
  title: "PR 7",
  url: "https://github.com/example/repo/pull/7",
  priority: "P1" as const,
  blocker: "external_reply",
  nextAction: "inspect reply",
  updatedAt: "2026-10-03T20:00:00Z",
  lastExternalAt: "2026-10-03T20:00:00Z",
  lastSelfAt: null,
  ciState: "none" as const,
  reviewDecision: null,
  mergeState: null,
};

function entry(depth: AttentionCacheEntry["depth"]): AttentionCacheEntry {
  return { sourceUpdatedAt: record.updatedAt, depth, record };
}

describe("public attention cache", () => {
  it("reuses unchanged deep rows, but promotes commented shallow rows to deep inspection", () => {
    assert.equal(canReuseAttention(entry("deep"), record.updatedAt, 3), true);
    assert.equal(canReuseAttention(entry("shallow"), record.updatedAt, 3), false);
    assert.equal(canReuseAttention(entry("shallow"), record.updatedAt, 0), true);
    assert.equal(canReuseAttention(entry("deep"), "2026-10-03T21:00:00Z", 3), false);
  });

  it("round-trips only the matching classifier version", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "attention-cache-"));
    const file = path.join(root, "cache.json");
    writeAttentionCache(file, new Map([["1", entry("deep")]]), "2026-10-03T22:00:00Z", 7);
    assert.equal(readAttentionCache(file, 7).get("1")?.record.repo, "example/repo");
    assert.equal(readAttentionCache(file, 8).size, 0);
  });
});
