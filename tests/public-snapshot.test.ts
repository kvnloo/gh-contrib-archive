import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { PUBLIC_DB_PATH } from "../lib/db.ts";
import {
  compilePublicSnapshot,
  writePublicSnapshot,
} from "../lib/public-snapshot.ts";

const snapshot = compilePublicSnapshot(PUBLIC_DB_PATH);

describe("public snapshot compiler", () => {
  it("derives ledger and world payloads from one public-safe source", () => {
    assert.equal(snapshot.manifest.privacy, "public-safe");
    assert.equal(snapshot.archive.privacy, "public-safe");
    assert.equal(snapshot.worldGraph.privacy, "public-safe");
    assert.equal(snapshot.manifest.counts.events, snapshot.archive.stats.total);
    assert.equal(snapshot.manifest.counts.events, snapshot.worldGraph.nodes.length);
    assert.ok(snapshot.manifest.lastCheckedAt);
    assert.ok(snapshot.manifest.lastChangedAt);
  });

  it("never emits private repository metadata or content", () => {
    const privateItems = snapshot.archive.items.filter((item) => item.visibility === "private");
    assert.ok(privateItems.length > 0);

    for (const item of privateItems) {
      assert.equal("url" in item, false);
      assert.equal("repo" in item, false);
      assert.equal("title" in item, false);
      assert.equal("excerpt" in item, false);
      assert.equal("number" in item, false);
      assert.equal("flags" in item, false);
    }

    const privateNodes = snapshot.worldGraph.nodes.filter((node) => node.visibility === "private");
    assert.ok(privateNodes.length > 0);
    for (const node of privateNodes) {
      assert.equal("url" in node, false);
      assert.equal("repo" in node, false);
      assert.equal("org" in node, false);
      assert.equal("title" in node, false);
      assert.equal("number" in node, false);
      assert.equal("flags" in node, false);
    }

    for (const commit of snapshot.worldGraph.commits.filter((row) => row.visibility === "private")) {
      assert.equal(commit.repo, null);
      assert.equal(commit.url, null);
    }
  });

  it("is deterministic for the same database", () => {
    const again = compilePublicSnapshot(PUBLIC_DB_PATH);
    assert.deepEqual(again, snapshot);
  });

  it("writes the manifest, archive, and world graph together", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gh-contrib-public-"));
    try {
      writePublicSnapshot(PUBLIC_DB_PATH, dir);
      const manifest = JSON.parse(readFileSync(path.join(dir, "data", "manifest.json"), "utf8"));
      const archive = JSON.parse(readFileSync(path.join(dir, "data", "archive.json"), "utf8"));
      const graph = JSON.parse(readFileSync(path.join(dir, "world-graph.json"), "utf8"));

      assert.deepEqual(manifest, snapshot.manifest);
      assert.deepEqual(archive, snapshot.archive);
      assert.deepEqual(graph, snapshot.worldGraph);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
