import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MYCELIUM_LOOK,
  myceliumCameraPose,
} from "../components/worlds/mycelium/look.ts";
import { streamCenter, WATER_LEVEL } from "../components/worlds/mycelium/terrain.ts";

describe("Mycelium macro composition profile", () => {
  it("centers the camera and its look target on the stream", () => {
    const pose = myceliumCameraPose(streamCenter);
    assert.equal(pose.home.x, streamCenter(pose.home.z));
    assert.equal(pose.target.x, streamCenter(pose.target.z));
  });

  it("keeps the camera low but clearly above the waterline", () => {
    const pose = myceliumCameraPose(streamCenter);
    assert.ok(pose.home.y - WATER_LEVEL >= 1.25);
    assert.ok(pose.home.y - WATER_LEVEL <= 2.2);
  });

  it("opens the foreground channel instead of building canyon walls around the lens", () => {
    assert.ok(MYCELIUM_LOOK.terrain.channelHalfWidth >= 3.0);
    assert.ok(MYCELIUM_LOOK.terrain.bankHeight <= 2.8);
    assert.ok(MYCELIUM_LOOK.terrain.foregroundFrameHeight <= 3.6);
  });

  it("keeps the cool lighting budget below the old blown-out baseline", () => {
    assert.ok(MYCELIUM_LOOK.grade.exposure <= 0.75);
    assert.ok(MYCELIUM_LOOK.grade.bloomStrength <= 0.3);
    assert.ok(MYCELIUM_LOOK.lights.cityGlow <= 700);
    assert.ok(MYCELIUM_LOOK.lights.colony <= 140);
    assert.ok(MYCELIUM_LOOK.lights.ambient <= 0.7);
  });

  it("retains a visible warm counter-light against the teal", () => {
    assert.ok(MYCELIUM_LOOK.lights.warmCore >= MYCELIUM_LOOK.lights.colony);
    assert.ok(MYCELIUM_LOOK.lights.warmColonyFraction >= 0.25);
  });
});
