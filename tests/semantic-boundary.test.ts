import assert from "node:assert/strict";
import { test } from "node:test";
import { emptySemanticGraph, filterSemanticGraph, type PublicSemanticGraph } from "../lib/semantic-graph.ts";
import { contentRevision } from "../lib/resource-revision.ts";

const allowed = new Set(["example/a", "example/b"]);
const extra = { body: "SYNTHETIC_RAW_BODY", content: "SYNTHETIC_SOURCE", token: "SYNTHETIC_TOKEN" };

test("final semantic export re-projects every level, not just repository identities", () => {
  const graph = {
    ...emptySemanticGraph(), source: "gitnexus", gitnexusVersion: "1.6.12", ...extra,
    hotset: [
      { repo: "example/a", alias: "example__a", sha: "a", lastActivityAt: null, activityCount: 1, status: "indexed", ...extra },
      { repo: "example/private", alias: "private", status: "indexed" },
    ],
    concepts: [{ id: "cache", query: "cache", ...extra, repos: [
      { repo: "example/a", processCount: 1, definitionCount: 0, symbolCount: 0, topProcesses: ["CacheFlow"], topFiles: ["src/cache.ts"], ...extra },
      { repo: "example/private", processCount: 1, ...extra },
    ] }],
    repoLinks: [{ source: "example/a", target: "example/b", sharedConcepts: ["cache"], weight: 1, ...extra }],
  } as PublicSemanticGraph;
  const safe = filterSemanticGraph(graph, allowed);
  assert.equal(safe.hotset[0]?.repo, "example/a");
  assert.equal(safe.concepts[0]?.repos[0]?.topProcesses[0], "CacheFlow");
  assert.equal(safe.repoLinks[0]?.weight, 1);
  assert.equal(JSON.stringify(safe).includes("SYNTHETIC_"), false);
  assert.equal(JSON.stringify(safe).includes("example/private"), false);
});

test("malformed nested semantic rows fail closed without crashing the export", () => {
  const graph = { ...emptySemanticGraph(), hotset: [null], concepts: [null, { id: "cache", query: "cache", repos: [null] }], repoLinks: [null] };
  const safe = filterSemanticGraph(graph as unknown as PublicSemanticGraph, allowed);
  assert.deepEqual(safe.hotset, []);
  assert.deepEqual(safe.concepts[0]?.repos, []);
  assert.deepEqual(safe.repoLinks, []);
});

test("semantic revision uses the canonical algorithm advertised by the read API", () => {
  const { revision, ...payload } = emptySemanticGraph();
  assert.equal(revision, contentRevision(payload));
});
