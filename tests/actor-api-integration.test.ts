import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openDb } from "../lib/db.ts";
import { writePublicApi } from "../lib/public-api.ts";

test("actor queries follow public revision descriptors without leaking private events", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "actor-api-integration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dbPath = path.join(root, "public.db");
  const attentionPath = path.join(root, "attention.db");
  const output = path.join(root, "public");
  const db = openDb(dbPath);
  try {
    db.prepare("INSERT INTO meta(key, value) VALUES('login', 'example-user')").run();
  } finally {
    db.close();
  }
  const event = {
    id: "comment:1", kind: "comment", actor: "example-reviewer", actorType: "User",
    at: "2026-10-03T00:00:00Z", authorAssociation: "MEMBER", reviewState: null,
    url: "https://github.com/example/public/pull/7#issuecomment-1", body: "SYNTHETIC_RAW_BODY",
  };
  const seed = {
    updatedAt: "2026-10-03T01:00:00Z", items: [],
    threads: [
      { repo: "example/public", number: 7, repoVisibility: "public", events: [event] },
      { repo: "example/private", number: 8, repoVisibility: "private", events: [{ ...event, actor: "private-actor" }] },
      { repo: "example/unknown", number: 9, repoVisibility: "unknown", events: [{ ...event, actor: "unknown-actor" }] },
    ],
  };
  const compile = () => {
    fs.writeFileSync(path.join(root, "attention-seed.json"), JSON.stringify(seed));
    return writePublicApi(dbPath, attentionPath, output);
  };
  const first = compile();
  assert.deepEqual(first.actors.actors.map((actor) => actor.login), ["example-reviewer"]);
  const actorDescriptor = first.actors.actors[0];
  const actorPath = path.join(output, "api/v1", actorDescriptor.href);
  const actorBytes = fs.readFileSync(actorPath);
  const actor = JSON.parse(actorBytes.toString("utf8"));
  assert.equal(actor.privacy, "public-safe");
  assert.equal(actor.revision, actorDescriptor.revision);
  assert.equal(actorBytes.byteLength, actorDescriptor.bytes);
  assert.equal(actor.authorAssociations.MEMBER, 1);
  assert.equal(actor.threads[0].href, "threads/example/public/7.json");
  assert.equal(first.index.resources.actors.revision, first.actors.revision);
  assert.equal(first.changes.resources.actors.revision, first.actors.revision);
  assert.equal(first.index.resources.actors.bytes, fs.statSync(path.join(output, "api/v1/actors.json")).size);
  const published = JSON.stringify([first.actors, [...first.actorResources.values()]]);
  for (const forbidden of ["private-actor", "unknown-actor", "example/private", "example/unknown", "SYNTHETIC_RAW_BODY"]) {
    assert.equal(published.includes(forbidden), false);
  }
  seed.updatedAt = "2026-10-03T02:00:00Z";
  assert.equal(compile().actors.revision, first.actors.revision);
  event.authorAssociation = "COLLABORATOR";
  const changed = compile();
  assert.notEqual(changed.actors.revision, first.actors.revision);
  assert.notEqual(changed.actors.actors[0].revision, actorDescriptor.revision);
  assert.equal(changed.actors.actors[0].eventCount, actorDescriptor.eventCount);
});
