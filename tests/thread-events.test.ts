import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { openDb } from "../lib/db.ts";
import { writePublicApi } from "../lib/public-api.ts";

describe("public thread events", () => {
  it("answers who replied without publishing raw bodies", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-thread-events-"));
    const publicDbPath = path.join(root, "public.db");
    const attentionDbPath = path.join(root, "attention.db");
    const outputRoot = path.join(root, "public");

    const db = openDb(publicDbPath);
    try {
      db.prepare("INSERT INTO meta(key, value) VALUES('login', 'kvnloo')").run();
    } finally {
      db.close();
    }

    fs.writeFileSync(
      path.join(root, "attention-seed.json"),
      JSON.stringify({
        updatedAt: "2026-10-03T22:21:12Z",
        items: [],
        threads: [
          {
            repo: "pingdotgg/t3code",
            repoVisibility: "public",
            number: 13967,
            events: [
              {
                id: "comment:5897065972",
                kind: "comment",
                actor: "andybergon",
                at: "2026-09-29T19:22:18Z",
                reviewState: null,
                url: "https://github.com/pingdotgg/t3code/pull/13967#issuecomment-5897065972",
                body: "discard-me",
              },
              {
                id: "comment:5974077170",
                kind: "comment",
                actor: "kvnloo",
                at: "2026-10-03T22:21:12Z",
                reviewState: null,
                url: "https://github.com/pingdotgg/t3code/pull/13967#issuecomment-5974077170",
                body: "discard-me-too",
              },
            ],
          },
        ],
      }),
      "utf8",
    );

    writePublicApi(publicDbPath, attentionDbPath, outputRoot);
    const threadPath = path.join(
      outputRoot,
      "api",
      "v1",
      "threads",
      "pingdotgg",
      "t3code",
      "13967.json",
    );
    const thread = JSON.parse(fs.readFileSync(threadPath, "utf8"));
    assert.deepEqual(
      thread.events.map((event) => event.actor),
      ["andybergon", "kvnloo"],
    );
    assert.equal(thread.events.some((event) => "body" in event), false);
    assert.equal(thread.evidenceRefs.includes("comment:5897065972"), true);
    assert.equal(thread.evidenceRefs.includes("comment:5974077170"), true);
  });
});
