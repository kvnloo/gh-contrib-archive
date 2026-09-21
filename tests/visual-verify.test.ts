import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeSeededRng } from "../components/worlds/visualVerify.ts";

describe("visual verification RNG", () => {
  it("replays the same sequence for the same seed", () => {
    const a = makeSeededRng(0x12345678);
    const b = makeSeededRng(0x12345678);
    assert.deepEqual(
      Array.from({ length: 16 }, () => a()),
      Array.from({ length: 16 }, () => b()),
    );
  });

  it("changes sequence when the seed changes", () => {
    const a = makeSeededRng(1);
    const b = makeSeededRng(2);
    assert.notDeepEqual(
      Array.from({ length: 8 }, () => a()),
      Array.from({ length: 8 }, () => b()),
    );
  });
});
