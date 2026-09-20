import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publicAssetPath } from "../lib/public-path.ts";

describe("publicAssetPath", () => {
  it("keeps root-hosted assets unchanged when no base path is configured", () => {
    assert.equal(publicAssetPath("/world-graph.json", ""), "/world-graph.json");
  });

  it("prefixes project-page assets exactly once", () => {
    assert.equal(
      publicAssetPath("/world-graph.json", "/gh-contrib-archive"),
      "/gh-contrib-archive/world-graph.json",
    );
    assert.equal(
      publicAssetPath("textures/mycelium/soil-albedo.png", "/gh-contrib-archive/"),
      "/gh-contrib-archive/textures/mycelium/soil-albedo.png",
    );
  });

  it("normalizes base paths without creating protocol-relative URLs", () => {
    assert.equal(publicAssetPath("/dream-targets/x.png", "gh-contrib-archive"), "/gh-contrib-archive/dream-targets/x.png");
    assert.equal(publicAssetPath("/", "/gh-contrib-archive/"), "/gh-contrib-archive/");
  });

  it("leaves external and data URLs alone", () => {
    assert.equal(publicAssetPath("https://github.com/kvnloo", "/gh-contrib-archive"), "https://github.com/kvnloo");
    assert.equal(publicAssetPath("data:image/png;base64,abc", "/gh-contrib-archive"), "data:image/png;base64,abc");
  });
});
