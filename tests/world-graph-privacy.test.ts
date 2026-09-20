import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PUBLIC_DB_PATH } from "../lib/db.ts";
import { compilePublicSnapshot } from "../lib/public-snapshot.ts";

const graph = compilePublicSnapshot(PUBLIC_DB_PATH).worldGraph;

describe("public-safe world graph", () => {
  it("is marked public-safe", () => {
    assert.equal(graph.privacy, "public-safe");
  });

  it("never exposes GitHub URLs, titles, or repos on private nodes", () => {
    const leaked = graph.nodes.filter((node) => node.visibility === "private").filter((node) => {
      return (
        "url" in node ||
        "title" in node ||
        "repo" in node ||
        "org" in node ||
        "number" in node ||
        "flags" in node
      );
    });
    assert.equal(leaked.length, 0);
  });

  it("gives public events real GitHub links", () => {
    const publicNodes = graph.nodes.filter((node) => node.visibility === "public");
    assert.ok(publicNodes.length > 0);
    assert.ok(publicNodes.every((node) => node.url.startsWith("https://github.com/")));
  });

  it("never names private commit repos or URLs", () => {
    const leaked = graph.commits.filter(
      (commit) => commit.visibility === "private" && (commit.repo || commit.url),
    );
    assert.equal(leaked.length, 0);
  });
});
