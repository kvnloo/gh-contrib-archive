import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  publicThreadEventsFromRest,
  readThreadEventsSeed,
  writeThreadEventsSeed,
} from "../lib/public-thread-events.ts";

describe("public thread event ledger", () => {
  it("retains actor/timing/review metadata without retaining bodies", () => {
    const events = publicThreadEventsFromRest(
      [
        {
          id: 11,
          body: "secret body that must not persist",
          created_at: "2026-10-03T18:00:00Z",
          html_url: "https://github.com/example/repo/pull/7#issuecomment-11",
          author_association: "MEMBER",
          user: { login: "maintainer", type: "User" },
        },
      ],
      [
        {
          id: 12,
          body: "request changes secret",
          submitted_at: "2026-10-03T19:00:00Z",
          html_url: "https://github.com/example/repo/pull/7#pullrequestreview-12",
          author_association: "COLLABORATOR",
          state: "CHANGES_REQUESTED",
          user: { login: "reviewer", type: "User" },
        },
      ],
    );

    assert.equal(events.length, 2);
    assert.deepEqual(events.map((event) => event.actor), ["maintainer", "reviewer"]);
    assert.equal(events[1].reviewState, "CHANGES_REQUESTED");
    assert.equal(JSON.stringify(events).includes("secret body"), false);
    assert.equal(JSON.stringify(events).includes("request changes secret"), false);
  });

  it("round-trips a public-safe thread seed", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "thread-events-"));
    const file = path.join(root, "thread-events-seed.json");
    const events = publicThreadEventsFromRest(
      [
        {
          id: 11,
          created_at: "2026-10-03T18:00:00Z",
          user: { login: "maintainer", type: "User" },
        },
      ],
      [],
    );

    writeThreadEventsSeed(
      file,
      new Map([
        [
          "example/repo#7",
          {
            repo: "example/repo",
            number: 7,
            sourceUpdatedAt: "2026-10-03T19:00:00Z",
            events,
          },
        ],
      ]),
      "2026-10-03T19:05:00Z",
    );

    const seed = readThreadEventsSeed(file);
    assert.equal(seed?.threads["example/repo#7"]?.events[0]?.actor, "maintainer");
    assert.equal(seed?.threads["example/repo#7"]?.sourceUpdatedAt, "2026-10-03T19:00:00Z");
  });
});
