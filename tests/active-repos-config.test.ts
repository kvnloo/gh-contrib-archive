import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const config = JSON.parse(fs.readFileSync("data/active-repos.json", "utf8"));

test("active repository pins are bounded, unique, and public-safe identifiers", () => {
  assert.equal(config.schemaVersion, 1);
  assert.ok(Number.isInteger(config.recentDays));
  assert.ok(config.recentDays >= 30 && config.recentDays <= 180);
  assert.ok(Array.isArray(config.pins));
  assert.ok(config.pins.length <= 64);
  assert.equal(new Set(config.pins).size, config.pins.length);
  for (const repo of config.pins) {
    assert.match(repo, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert.equal(repo.includes(".."), false);
  }
  assert.ok(config.pins.includes("bilawalsidhu/gods-eye-view"));
  assert.ok(config.pins.includes("NousResearch/hermes-agent"));
  assert.ok(config.pins.includes("pingdotgg/t3code"));
});
