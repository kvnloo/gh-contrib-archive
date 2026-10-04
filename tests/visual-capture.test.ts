import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSceneCaptureMode, sceneCaptureTime } from "../lib/visual-capture.ts";

describe("visual capture mode", () => {
  it("recognizes only the explicit scene-only capture flag", () => {
    assert.equal(isSceneCaptureMode("?capture=scene"), true);
    assert.equal(isSceneCaptureMode("?capture=page"), false);
    assert.equal(isSceneCaptureMode(""), false);
  });

  it("freezes scene time for deterministic screenshots", () => {
    assert.equal(sceneCaptureTime(true, 12.5), 0);
    assert.equal(sceneCaptureTime(false, 12.5), 12.5);
  });
});
