import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { mapConcurrent } from "../lib/async-pool.ts";

describe("mapConcurrent", () => {
  it("bounds in-flight work and preserves input order", async () => {
    let active = 0;
    let maxActive = 0;

    const result = await mapConcurrent([4, 3, 2, 1], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(value);
      active -= 1;
      return value * 10;
    });

    assert.equal(maxActive, 2);
    assert.deepEqual(result, [40, 30, 20, 10]);
  });

  it("treats invalid limits as serial execution", async () => {
    let active = 0;
    let maxActive = 0;

    await mapConcurrent([1, 2, 3], 0, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(1);
      active -= 1;
      return value;
    });

    assert.equal(maxActive, 1);
  });
});
