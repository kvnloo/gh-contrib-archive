import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

type Node = {
  visibility: string;
  url?: string;
  title?: string;
  repo?: string;
  excerpt?: string;
};

type Graph = {
  privacy: string;
  nodes: Node[];
  commits: { visibility: string; repo: string | null; url: string | null }[];
};

const graph = JSON.parse(readFileSync(new URL("../public/world-graph.json", import.meta.url), "utf8")) as Graph;

describe("public-safe world graph", () => {
  it("is marked public-safe", () => {
    assert.equal(graph.privacy, "public-safe");
  });

  it("never exposes GitHub URLs, titles, or repos on private nodes", () => {
    const leaked = graph.nodes.filter((n) => n.visibility === "private").filter((n) => {
      const url = n.url ?? "";
      return (
        Boolean(n.title) ||
        Boolean(n.repo) ||
        Boolean(n.excerpt) ||
        url.startsWith("https://github.com/")
      );
    });
    assert.equal(leaked.length, 0);
  });

  it("gives public events real GitHub links", () => {
    const publicNodes = graph.nodes.filter((n) => n.visibility === "public");
    assert.ok(publicNodes.length > 0);
    assert.ok(publicNodes.every((n) => (n.url ?? "").startsWith("https://github.com/")));
  });

  it("never names private commit repos or URLs", () => {
    const leaked = graph.commits.filter((c) => c.visibility === "private" && (c.repo || c.url));
    assert.equal(leaked.length, 0);
  });
});
