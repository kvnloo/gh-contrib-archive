import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openDb } from "../lib/db.ts";
import { writePublicApi } from "../lib/public-api.ts";
import { contentRevision } from "../lib/resource-revision.ts";

test("semantic lookup respects public archive identities and revision descriptors", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-api-integration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dbPath = path.join(root, "public.db");
  const out = path.join(root, "public");
  const db = openDb(dbPath);
  try {
    const insert = db.prepare(`INSERT INTO contributions (
      id, github_node_id, type, url, html_url, repo, number, title, excerpt,
      body_chars, state, visibility, created_at, updated_at, ingested_at, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const visibility of ["public", "private"]) {
      const repo = `example/${visibility}`;
      const url = `https://github.com/${repo}/pull/7`;
      insert.run(visibility, visibility, "pull_request", url, url, repo, 7,
        "Synthetic PR", "", 0, "OPEN", visibility, "2026-10-03T00:00:00Z",
        "2026-10-03T00:00:00Z", "2026-10-03T00:00:00Z", null);
    }
    db.prepare("INSERT INTO meta(key, value) VALUES('login', 'example-user')").run();
  } finally {
    db.close();
  }
  const graph = {
    schemaVersion: 1, privacy: "public-safe", source: "gitnexus", gitnexusVersion: "1.6.12",
    embeddings: false, revision: "untrusted", body: "SYNTHETIC_BODY",
    hotset: ["public", "private", "unknown"].map((visibility) => ({
      repo: `example/${visibility}`, alias: visibility, sha: "a", lastActivityAt: null,
      activityCount: 1, status: "indexed", content: "SYNTHETIC_SOURCE",
    })),
    concepts: [{ id: "cache", query: "cache", repos: ["public", "private", "unknown"].map((visibility) => ({
      repo: `example/${visibility}`, processCount: 1, definitionCount: 0, symbolCount: 0,
      topProcesses: ["CacheFlow"], topFiles: ["src/cache.ts"], content: "SYNTHETIC_SOURCE",
    })) }], repoLinks: [],
  };
  fs.writeFileSync(path.join(root, "semantic-graph.json"), JSON.stringify(graph));
  const api = writePublicApi(dbPath, path.join(root, "attention.db"), out);
  const descriptor = api.index.resources.semantic;
  const bytes = fs.readFileSync(path.join(out, "api/v1", descriptor.href));
  const result = JSON.parse(bytes.toString("utf8"));
  assert.deepEqual(result.hotset.map((repo: { repo: string }) => repo.repo), ["example/public"]);
  assert.deepEqual(result.concepts[0].repos.map((repo: { repo: string }) => repo.repo), ["example/public"]);
  assert.equal(result.concepts[0].repos[0].topProcesses[0], "CacheFlow");
  assert.equal(bytes.byteLength, descriptor.bytes);
  assert.equal(result.revision, descriptor.revision);
  assert.equal(result.revision, api.changes.resources.semantic.revision);
  const { revision, ...payload } = result;
  assert.equal(revision, contentRevision(payload));
  for (const forbidden of ["SYNTHETIC_BODY", "SYNTHETIC_SOURCE", "example/private", "example/unknown"]) {
    assert.equal(bytes.toString("utf8").includes(forbidden), false);
  }
});
