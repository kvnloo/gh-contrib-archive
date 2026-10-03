import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyPullRequest,
  sortAttention,
  type PullRequestSnapshot,
} from "../lib/attention.ts";

function snapshot(overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
  return {
    repo: "pingdotgg/t3code",
    number: 14236,
    title: "fix composer",
    url: "https://github.com/pingdotgg/t3code/pull/14236",
    state: "OPEN",
    isDraft: false,
    author: "kvnloo",
    reviewDecision: null,
    mergeState: "CLEAN",
    updatedAt: "2026-10-01T05:27:57Z",
    notificationReasons: [],
    activities: [],
    checks: [],
    ...overrides,
  };
}

describe("attention classification", () => {
  it("makes fresh human verification requests P0", () => {
    const result = classifyPullRequest(
      snapshot({
        activities: [
          {
            actor: "kvnloo",
            body: "pushed fix",
            at: "2026-10-01T05:00:00Z",
            kind: "comment",
          },
          {
            actor: "juliusmarminge",
            body: "Please run the focused tests and add before/after screenshots plus a recording.",
            at: "2026-10-01T05:27:57Z",
            kind: "comment",
          },
        ],
      }),
      "kvnloo",
    );
    assert.equal(result.priority, "P0");
    assert.equal(result.blocker, "verification_requested");
  });

  it("makes requested changes P0", () => {
    const result = classifyPullRequest(
      snapshot({
        activities: [
          {
            actor: "maintainer",
            body: "needs a fix",
            at: "2026-10-01T06:00:00Z",
            kind: "review",
            reviewState: "CHANGES_REQUESTED",
          },
        ],
      }),
      "kvnloo",
    );
    assert.equal(result.priority, "P0");
    assert.equal(result.blocker, "changes_requested");
  });

  it("ignores bot chatter when finding unanswered human feedback", () => {
    const result = classifyPullRequest(
      snapshot({
        activities: [
          {
            actor: "coderabbitai[bot]",
            body: "please test",
            at: "2026-10-01T06:00:00Z",
            kind: "comment",
          },
        ],
      }),
      "kvnloo",
    );
    assert.equal(result.priority, "P2");
    assert.equal(result.blocker, "awaiting_review");
  });

  it("puts failing CI ahead of ordinary review waiting", () => {
    const failed = classifyPullRequest(
      snapshot({ checks: [{ name: "test", state: "FAILURE" }] }),
      "kvnloo",
    );
    const waiting = classifyPullRequest(snapshot(), "kvnloo");
    assert.equal(failed.priority, "P1");
    assert.deepEqual(
      sortAttention([waiting, failed]).map((item) => item.blocker),
      ["ci_failed", "awaiting_review"],
    );
  });

  it("does not retain comment bodies or secrets in normalized output", () => {
    const result = classifyPullRequest(
      snapshot({
        activities: [
          {
            actor: "maintainer",
            body: "Please verify with token ghp_DO_NOT_STORE",
            at: "2026-10-01T06:00:00Z",
            kind: "comment",
          },
        ],
      }),
      "kvnloo",
    );
    assert.equal(JSON.stringify(result).includes("ghp_DO_NOT_STORE"), false);
    assert.equal("activities" in result, false);
  });
});
