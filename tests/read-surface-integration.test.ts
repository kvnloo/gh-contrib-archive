import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readThreadEventsSeed } from "../lib/public-thread-events.ts";
import { projectAttentionEvents } from "../lib/public-attention-cache.ts";

const event = {
  id: "comment:1", actor: "example-reviewer", kind: "comment", at: "2026-10-03T00:00:00Z",
  actorType: "User", authorAssociation: "MEMBER", reviewState: null,
  url: "https://github.com/example/public/pull/7#issuecomment-1",
  body: "SYNTHETIC_RAW_FEEDBACK", extra: { token: "SYNTHETIC_TOKEN" },
};

function seedFor(t: { after: (fn: () => void) => void }, threads: unknown) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "read-surface-integration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "events.json");
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 1, privacy: "public-safe", updatedAt: event.at, threads,
  }));
  return readThreadEventsSeed(file);
}

test("legacy events re-project metadata instead of leaking extra feedback fields", (t) => {
  const seed = seedFor(t, { "example/public#7": {
    repo: "example/public", number: 7, sourceUpdatedAt: event.at, events: [event],
  }});
  assert.equal(seed?.threads["example/public#7"]?.events[0]?.authorAssociation, "MEMBER");
  assert.equal(JSON.stringify(seed).includes("SYNTHETIC_"), false);
});

test("legacy event identity must match its lookup key", (t) => {
  const seed = seedFor(t, { "example/public#7": {
    repo: "example/other", number: 9, sourceUpdatedAt: event.at, events: [event],
  }});
  assert.deepEqual(Object.keys(seed?.threads ?? {}), []);
});

test("warm-cache events retain role metadata but never arbitrary fields", () => {
  const events = projectAttentionEvents([event]);
  assert.equal(events[0]?.actorType, "User");
  assert.equal(events[0]?.authorAssociation, "MEMBER");
  assert.equal(JSON.stringify(events).includes("SYNTHETIC_"), false);
  const invalid = projectAttentionEvents([{ ...event, actorType: "SYNTHETIC_TOKEN", authorAssociation: "SYNTHETIC_TOKEN" }]);
  assert.equal(JSON.stringify(invalid).includes("SYNTHETIC_"), false);
});
