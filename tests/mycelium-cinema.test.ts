import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cinemaProfile, advanceSceneTime, shouldRenderFrame } from '../components/worlds/mycelium/cinema-profile.ts';

describe('Mycelium cinema', () => {
  it('caps phone render cost without removing the real 3D scene', () => {
    const phone = cinemaProfile(390, 3, false);
    const desktop = cinemaProfile(1440, 2, false);
    assert.ok(phone.pixelRatio <= 1.25);
    assert.ok(phone.terrainSegments < desktop.terrainSegments);
    assert.ok(phone.reflectionSize < desktop.reflectionSize);
    assert.ok(phone.sporeCount > 0);
    assert.equal(phone.fps, 30);
  });
  it('keeps localized warm light instead of flattening the whole cavern into cyan', () => {
    const p = cinemaProfile(390, 3, false);
    assert.ok(p.coolLightScale > 0 && p.coolLightScale < 0.4);
    assert.ok(p.warmLightScale > p.coolLightScale);
    assert.ok(p.exposure > 0.3 && p.exposure <= 0.85);
  });
  it('freezes animation for pause, reduced motion, and deterministic capture', () => {
    assert.equal(advanceSceneTime(2, 0.02, false), 2);
    assert.equal(advanceSceneTime(2, 0.02, true), 2.02);
    assert.equal(advanceSceneTime(2, 10, true), 2.05);
    assert.equal(cinemaProfile(390, 3, true).autoplay, false);
  });
  it('skips hidden-tab rendering and bounds the frame cadence', () => {
    assert.equal(shouldRenderFrame(100, 0, 30, true), false);
    assert.equal(shouldRenderFrame(10, 0, 30, false), false);
    assert.equal(shouldRenderFrame(40, 0, 30, false), true);
  });
});
