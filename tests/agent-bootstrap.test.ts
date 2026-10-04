import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { compileAgentBootstrap, writeAgentBootstrap } from "../lib/agent-bootstrap.ts";
import { contentRevision } from "../lib/resource-revision.ts";
import type { CompiledPublicApi } from "../lib/public-api.ts";

function fixture(numbers = [13967, 13989]): CompiledPublicApi {
  const items = numbers.map((number) => ({
    repo: "pingdotgg/t3code", number, priority: "P0", title: `PR ${number}`,
    blocker: "verification_requested", nextAction: "run the requested verification",
    ciState: "none", updatedAt: "2026-10-03T19:25:00Z",
    url: `https://github.com/pingdotgg/t3code/pull/${number}`,
  }));
  const threads = items.map((item) => ({
    ...item, privacy: "public-safe", schemaVersion: 1, revision: contentRevision(item),
  }));
  return {
    attention: { schemaVersion: 1, privacy: "public-safe", revision: contentRevision(items),
      updatedAt: "2026-10-03T19:30:00Z", count: items.length, items },
    threadResources: new Map(threads.map((item) => [`${item.repo}#${item.number}`, item])),
  } as unknown as CompiledPublicApi;
}

describe("agent bootstrap", () => {
  it("answers both motivating T3 actions in one packet with revision links", () => {
    const packet = compileAgentBootstrap(fixture());
    assert.deepEqual(packet.items.map((row) => row.number), [13967, 13989]);
    assert.ok(packet.items.every((row) => row.priority === "P0" && row.nextAction));
    assert.equal(packet.items[0].thread.href, "threads/pingdotgg/t3code/13967.json");
    assert.match(packet.items[0].thread.revision, /^sha256:[a-f0-9]{64}$/);
    assert.equal(packet.scope, "cached-actionable-only");
  });

  it("projects an allowlist rather than publishing unknown fields or upstream URLs", () => {
    const api = fixture();
    Object.assign(api.attention.items[0], {
      body: "PRIVATE_SENTINEL", token: "PRIVATE_SENTINEL", extra: { note: "PRIVATE_SENTINEL" },
      url: "https://private.example/PRIVATE_SENTINEL",
    });
    assert.equal(JSON.stringify(compileAgentBootstrap(api)).includes("PRIVATE_SENTINEL"), false);
  });

  it("requires a matching public thread; private and unknown identities cannot be bootstrapped", () => {
    const api = fixture();
    api.attention.items.push({ ...api.attention.items[0], repo: "secret/private", number: 3 });
    api.attention.items.push({ ...api.attention.items[0], repo: "mystery/unknown", number: 4 });
    const text = JSON.stringify(compileAgentBootstrap(api));
    assert.equal(text.includes("secret/private"), false);
    assert.equal(text.includes("mystery/unknown"), false);
    api.threadResources.get("pingdotgg/t3code#13967")!.repo = "mismatched/repo";
    assert.equal(compileAgentBootstrap(api).items.length, 1);
  });

  it("sorts deterministically, removes waiting rows, and reports omitted actionable rows", () => {
    const api = fixture([3, 2, 1]);
    api.attention.items[0].priority = "P2";
    const packet = compileAgentBootstrap(api, { maxItems: 1 });
    assert.deepEqual(packet.items.map((row) => row.number), [1]);
    assert.equal(packet.actionableCached, 2);
    assert.equal(packet.omitted, 1);
    assert.equal(packet.truncated, true);
    api.attention.items.reverse();
    assert.equal(compileAgentBootstrap(api, { maxItems: 1 }).revision, packet.revision);
  });

  it("keeps semantic revision stable on refresh-only changes, not action changes", () => {
    const api = fixture();
    const before = compileAgentBootstrap(api);
    api.attention.updatedAt = "2026-10-03T20:30:00Z";
    assert.equal(compileAgentBootstrap(api).revision, before.revision);
    assert.notEqual(compileAgentBootstrap(api).source.updatedAt, before.source.updatedAt);
    api.attention.items[0].nextAction = "address a new finding";
    assert.notEqual(compileAgentBootstrap(api).revision, before.revision);
  });

  it("enforces an emitted UTF-8 byte budget with multibyte content", () => {
    const api = fixture(Array.from({ length: 20 }, (_, i) => i + 1));
    for (const row of api.attention.items) {
      row.title = "🚀".repeat(5000);
      row.nextAction = "🚀".repeat(5000);
    }
    const packet = compileAgentBootstrap(api, { maxBytes: 2048, maxItems: 20 });
    assert.ok(Buffer.byteLength(JSON.stringify(packet) + "\n") <= 2048);
    assert.ok(packet.omitted > 0);
    assert.equal(packet.count + packet.omitted, 20);
  });

  it("fails closed for a non-public snapshot or invalid budget", () => {
    const api = fixture();
    assert.throws(() => compileAgentBootstrap(api, { maxBytes: 0 }), RangeError);
    assert.throws(() => compileAgentBootstrap(api, { maxItems: NaN }), RangeError);
    Object.assign(api.attention, { privacy: "private" });
    assert.throws(() => compileAgentBootstrap(api), /public/);
  });

  it("writes exactly the bounded compact packet and does not mutate the source", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-"));
    try {
      const api = fixture();
      const before = JSON.stringify(api.attention);
      const packet = writeAgentBootstrap(api, root);
      const emitted = fs.readFileSync(path.join(root, "api/v1/bootstrap.json"), "utf8");
      assert.equal(emitted, JSON.stringify(packet) + "\n");
      assert.equal(JSON.stringify(api.attention), before);
      assert.ok(Buffer.byteLength(emitted) <= packet.maxBytes);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
