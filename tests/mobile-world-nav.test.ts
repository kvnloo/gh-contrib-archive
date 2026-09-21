import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adjacentWorldId,
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
});
