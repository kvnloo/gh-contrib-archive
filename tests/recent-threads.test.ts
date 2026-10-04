import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRecentThreads } from "../lib/recent-threads.ts";

describe("recent thread feed", () => {
  it("collapses contribution activity onto one canonical thread", () => {
    const rows = buildRecentThreads([
      {
        repo: "example/repo",
        number: 7,
        type: "pull_request",
        title: "Fix cache",
        url: "https://github.com/example/repo/pull/7",
        created_at: "2026-10-01T10:00:00Z",
        updated_at: "2026-10-01T11:00:00Z",
      },
      {
        repo: "example/repo",
        number: 7,
        type: "review_comment",
        title: "Fix cache",
        url: "https://github.com/example/repo/pull/7#discussion_r123",
        created_at: "2026-10-02T12:00:00Z",
        updated_at: null,
      },
    ], []);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].url, "https://github.com/example/repo/pull/7");
    assert.equal(rows[0].href, "threads/example/repo/7.json");
    assert.equal(rows[0].lastActivityAt, "2026-10-02T12:00:00Z");
    assert.deepEqual(rows[0].types, ["pull_request", "review_comment"]);
  });

  it("uses attention freshness and preserves actionable context", () => {
    const rows = buildRecentThreads(
      [
        {
          repo: "example/older",
          number: 1,
          type: "pull_request",
          title: "Older",
          url: "https://github.com/example/older/pull/1",
          created_at: "2026-10-03T18:00:00Z",
          updated_at: null,
        },
        {
          repo: "example/action",
          number: 2,
          type: "pull_request",
          title: "Action",
          url: "https://github.com/example/action/pull/2",
          created_at: "2026-10-03T17:00:00Z",
          updated_at: null,
        },
      ],
      [
        {
          repo: "example/action",
          number: 2,
          title: "Action",
          url: "https://github.com/example/action/pull/2",
          priority: "P0",
          blocker: "verification_requested",
          nextAction: "run verification",
          updatedAt: "2026-10-03T19:00:00Z",
        },
      ],
    );

    assert.equal(rows[0].repo, "example/action");
    assert.deepEqual(rows[0].attention, {
      priority: "P0",
      blocker: "verification_requested",
      nextAction: "run verification",
    });
  });
});
