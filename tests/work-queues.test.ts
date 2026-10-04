import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildWorkQueues, workQueueFor } from "../lib/work-queues.ts";
import type { AttentionRecord } from "../lib/attention.ts";

function record(
  blocker: string,
  overrides: Partial<AttentionRecord> = {},
): AttentionRecord {
  return {
    repo: "example/repo",
    repoVisibility: "public",
    number: 1,
    title: "PR",
    url: "https://github.com/example/repo/pull/1",
    priority: "P2",
    blocker,
    nextAction: "wait",
    updatedAt: "2026-10-03T20:00:00Z",
    lastExternalAt: null,
    lastSelfAt: null,
    ciState: "passing",
    reviewDecision: null,
    mergeState: "CLEAN",
    ...overrides,
  };
}

describe("work queues", () => {
  it("keeps action, ready, blocked, waiting, and superseded mutually exclusive", () => {
    assert.equal(workQueueFor(record("verification_requested", { priority: "P0" })), "needs_action");
    assert.equal(workQueueFor(record("approved", { reviewDecision: "APPROVED" })), "ready");
    assert.equal(workQueueFor(record("ci_failed", { ciState: "failing" })), "blocked");
    assert.equal(workQueueFor(record("awaiting_review")), "waiting");
    assert.equal(workQueueFor(record("superseded_candidate", { priority: "P1" })), "superseded");
  });

  it("does not call an approved PR ready while CI or merge state still blocks it", () => {
    assert.equal(
      workQueueFor(
        record("ci_failed", {
          priority: "P1",
          reviewDecision: "APPROVED",
          ciState: "failing",
        }),
      ),
      "blocked",
    );
    assert.equal(
      workQueueFor(
        record("merge_conflict", {
          priority: "P1",
          reviewDecision: "APPROVED",
          mergeState: "DIRTY",
        }),
      ),
      "blocked",
    );
  });

  it("preserves attention ordering within each queue", () => {
    const queues = buildWorkQueues([
      record("external_reply", { priority: "P1", number: 7 }),
      record("verification_requested", { priority: "P0", number: 8 }),
    ]);
    assert.deepEqual(queues.needs_action.map((item) => item.number), [7, 8]);
  });
});
