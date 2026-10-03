import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compileSemanticGraph,
  filterSemanticGraph,
  projectGitNexusResult,
} from "../lib/semantic-graph.ts";

describe("semantic graph projection", () => {
  it("keeps only whitelisted GitNexus metadata, never source content", () => {
    const hit = projectGitNexusResult("example/repo", {
      processes: [{ id: "p1", name: "CacheFlow", content: "SECRET SOURCE" }],
      definitions: [{ id: "d1", name: "CachePolicy", content: "SECRET SOURCE" }],
      process_symbols: [
        {
          id: "s1",
          name: "loadCache",
          filePath: "src/cache.ts",
          content: "SECRET SOURCE",
        },
      ],
    });

    assert.deepEqual(hit, {
      repo: "example/repo",
      processCount: 1,
      definitionCount: 1,
      symbolCount: 1,
      topProcesses: ["CacheFlow"],
      topFiles: ["src/cache.ts"],
    });
    assert.equal(JSON.stringify(hit).includes("SECRET SOURCE"), false);
  });

  it("links repositories only through shared concept evidence", () => {
    const hotset = [
      {
        repo: "example/a",
        alias: "example__a",
        sha: "a",
        lastActivityAt: "2026-10-03T20:00:00Z",
        activityCount: 4,
        status: "indexed" as const,
      },
      {
        repo: "example/b",
        alias: "example__b",
        sha: "b",
        lastActivityAt: "2026-10-03T19:00:00Z",
        activityCount: 3,
        status: "indexed" as const,
      },
    ];
    const results = new Map([
      [
        "example/a",
        new Map([
          ["performance", { processes: [{ name: "CacheFlow" }], definitions: [], process_symbols: [] }],
          ["privacy", { processes: [{ name: "Redaction" }], definitions: [], process_symbols: [] }],
        ]),
      ],
      [
        "example/b",
        new Map([
          ["performance", { processes: [{ name: "BatchFlow" }], definitions: [], process_symbols: [] }],
          ["privacy", { processes: [], definitions: [], process_symbols: [] }],
        ]),
      ],
    ]);

    const graph = compileSemanticGraph({
      gitnexusVersion: "1.6.12",
      embeddings: false,
      hotset,
      concepts: [
        { id: "performance", query: "cache concurrency" },
        { id: "privacy", query: "privacy redaction" },
      ],
      results,
    });

    assert.deepEqual(graph.repoLinks, [
      {
        source: "example/a",
        target: "example/b",
        sharedConcepts: ["performance"],
        weight: 1,
      },
    ]);
  });

  it("fails closed when semantic data contains a repo outside the public archive", () => {
    const graph = compileSemanticGraph({
      gitnexusVersion: "1.6.12",
      embeddings: false,
      hotset: [
        {
          repo: "example/public",
          alias: "example__public",
          sha: "a",
          lastActivityAt: null,
          activityCount: 1,
          status: "indexed",
        },
        {
          repo: "secret/private",
          alias: "secret__private",
          sha: "b",
          lastActivityAt: null,
          activityCount: 1,
          status: "indexed",
        },
      ],
      concepts: [{ id: "memory", query: "memory" }],
      results: new Map([
        ["example/public", new Map([["memory", { processes: [{ name: "Memory" }] }]])],
        ["secret/private", new Map([["memory", { processes: [{ name: "Secret" }] }]])],
      ]),
    });

    const filtered = filterSemanticGraph(graph, new Set(["example/public"]));
    assert.deepEqual(filtered.hotset.map((item) => item.repo), ["example/public"]);
    assert.deepEqual(filtered.concepts[0].repos.map((item) => item.repo), ["example/public"]);
    assert.equal(filtered.repoLinks.length, 0);
    assert.equal(JSON.stringify(filtered).includes("secret/private"), false);
  });
});
