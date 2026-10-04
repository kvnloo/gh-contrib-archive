import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Workflow is part of the key: receipt updates must not cancel the build.
// PR number (not head branch) isolates identically named fork branches.
// Ref is the fallback for push-triggered CI on each rollout branch.
const expectedGroup = "${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}";

describe("superseded validation runs", () => {
  for (const file of ["ci.yml", "receipt.yml", "labeler.yml"]) {
    it(`${file} cancels only its own superseded PR/ref checks`, () => {
      const text = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8");
      const block = text.match(/^concurrency:\n((?:[ \t]+[^\n]*\n)+)/m)?.[1];
      assert.ok(block, "workflow-level concurrency is required");
      assert.equal(block.match(/^  group: (.+)$/m)?.[1], expectedGroup);
      assert.match(block, /^  cancel-in-progress: true$/m);
      assert.doesNotMatch(block, /run_id|head_ref/, "new runs must share a key without sharing other PRs' keys");
    });
  }
});
