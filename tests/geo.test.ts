import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isoToLon, isoToYear, latForSeed } from "../components/worlds/night/geo.ts";

describe("black marble geo", () => {
  it("maps later years farther east", () => {
    assert.equal(isoToYear("2026-01-01T00:00:00Z"), 2026);
    assert.ok(isoToLon("2016-01-01T00:00:00Z") < isoToLon("2026-01-01T00:00:00Z"));
  });

  it("clusters 2025+ latitudes tighter than early years", () => {
    const early = Array.from({ length: 40 }, (_, i) => latForSeed(`e${i}`, 2016));
    const late = Array.from({ length: 40 }, (_, i) => latForSeed(`l${i}`, 2026));
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    assert.ok(spread(late) < spread(early));
  });
});
