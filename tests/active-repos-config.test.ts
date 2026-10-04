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

test("observed pins reuse visibility but still scan quiet open work", () => {
  const collector = fs.readFileSync("scripts/public-attention-sync.ts", "utf8");
  const start = collector.indexOf("for (const repo of [...new Set(pins)])");
  const end = collector.indexOf("const repositories =", start);
  assert.ok(start >= 0 && end > start);
  const pinLoop = collector.slice(start, end);
  const known = pinLoop.indexOf("known.has(repo.toLowerCase())");
  const visibilityRead = pinLoop.indexOf("reader.json(\`/repos/\${repo}\`)");
  const openScan = pinLoop.indexOf("involves:\${login} is:open");
  assert.ok(known >= 0);
  assert.ok(visibilityRead > known);
  assert.ok(openScan > known);
  assert.match(pinLoop, /quiet older open work/);
});
