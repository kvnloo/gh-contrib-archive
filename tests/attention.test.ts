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
    repoVisibility: "public",
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

  it("carries live repository visibility into normalized state", () => {
    assert.equal(classifyPullRequest(snapshot({ repoVisibility: "private" }), "kvnloo").repoVisibility, "private");
    assert.equal(classifyPullRequest(snapshot({ repoVisibility: "unknown" }), "kvnloo").repoVisibility, "unknown");
  });
  it("does not make positive review evidence P0 merely because it mentions tests", () => {
    const result = classifyPullRequest(
      snapshot({
        activities: [
          {
            actor: "reviewer",
            body: "Tests passed. No new finding in this focused pass.",
            at: "2026-10-03T02:37:42Z",
            kind: "review",
            reviewState: "COMMENTED",
          },
        ],
      }),
      "kvnloo",
    );
    assert.equal(result.priority, "P2");
    assert.equal(result.blocker, "review_update_no_action");
  });

  it("makes concrete requested regression additions P0", () => {
    const result = classifyPullRequest(
      snapshot({
        activities: [
          {
            actor: "reviewer",
            body: "One useful addition is a test against React Native's installed version catalog.",
            at: "2026-10-03T03:00:00Z",
            kind: "comment",
          },
        ],
      }),
      "kvnloo",
    );
    assert.equal(result.priority, "P0");
    assert.equal(result.blocker, "verification_requested");
  });

  it("marks an explicitly competing implementation as a superseded candidate", () => {
    const result = classifyPullRequest(
      snapshot({
        activities: [
          {
            actor: "maintainer",
            body: "We will likely merge #3806 in favor of this as it fixes the issue upstream.",
            at: "2026-10-03T03:30:00Z",
            kind: "comment",
          },
        ],
      }),
      "kvnloo",
    );
    assert.equal(result.priority, "P1");
    assert.equal(result.blocker, "superseded_candidate");
  });
});
