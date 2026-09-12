import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WORLDS } from "../components/worlds/catalog.ts";

describe("world catalog", () => {
  it("has five unique worlds with keys 1-5", () => {
    assert.equal(WORLDS.length, 5);
    assert.deepEqual(
      WORLDS.map((w) => w.id),
      ["mycelium", "night", "phase", "metro", "constellation"],
    );
    assert.ok(typeof WORLDS.map === "function");
    assert.deepEqual(
      WORLDS.map((w) => w.keys),
      ["1", "2", "3", "4", "5"],
    );
  });
});
