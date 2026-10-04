import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  canReuseAttention,
  projectAttentionEvents,
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
  return { sourceUpdatedAt: record.updatedAt, depth, record, events: [] };
}

describe("public attention cache", () => {
  it("projects body-free event fields from an untrusted cache", () => {
    const events = projectAttentionEvents([{
      id: "comment:1", kind: "comment", actor: "example-reviewer", at: record.updatedAt,
      reviewState: null, url: "https://github.com/example/repo/pull/7#issuecomment-1",
      body: "RAW_BODY_DO_NOT_PERSIST", extra: { token: "DO_NOT_PERSIST" },
    }]);
    assert.equal(events.length, 1);
    assert.equal(JSON.stringify(events).includes("DO_NOT_PERSIST"), false);
    assert.deepEqual(Object.keys(events[0]).sort(), ["actor", "at", "id", "kind", "reviewState", "url"]);
  });
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
