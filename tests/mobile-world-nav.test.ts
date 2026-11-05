import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adjacentWorldId,
  worldIdForPath,
  worldIdForSwipe,
} from "../components/worlds/navigation.ts";

describe("mobile world navigation", () => {
  it("wraps previous/next navigation across the five worlds", () => {
    assert.equal(adjacentWorldId("mycelium", -1), "constellation");
    assert.equal(adjacentWorldId("constellation", 1), "mycelium");
    assert.equal(adjacentWorldId("phase", 1), "metro");
    assert.equal(adjacentWorldId("phase", -1), "night");
  });

  it("maps horizontal swipe intent without hijacking small gestures", () => {
    assert.equal(worldIdForSwipe("phase", -80), "metro");
    assert.equal(worldIdForSwipe("phase", 80), "night");
    assert.equal(worldIdForSwipe("phase", -30), "phase");
    assert.equal(worldIdForSwipe("phase", 30), "phase");
  });

  it("falls back to the first world when the current route is unknown", () => {
    assert.equal(adjacentWorldId("unknown", 1), "night");
    assert.equal(worldIdForSwipe("unknown", 80), "constellation");
  });

  it("resolves the current world from exported trailing-slash and basePath routes", () => {
    // next.config uses trailingSlash: true, so the live pathname is /gh-contrib-archive/worlds/metro/.
    assert.equal(worldIdForPath("/gh-contrib-archive/worlds/metro/"), "metro");
    assert.equal(worldIdForPath("/worlds/constellation"), "constellation");
    assert.equal(worldIdForPath("/worlds/phase/"), "phase");
    assert.equal(adjacentWorldId(worldIdForPath("/worlds/metro/"), 1), "constellation");
    assert.equal(worldIdForPath("/worlds/"), "mycelium");
  });
});
