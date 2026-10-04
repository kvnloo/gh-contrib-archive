import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const promote = readFileSync(new URL("../.github/workflows/promote-preview.yml", import.meta.url), "utf8");
const automerge = readFileSync(new URL("../.github/workflows/automerge-preview.yml", import.meta.url), "utf8");

describe("preview promotion", () => {
  it("promotes preview automatically and is reusable from token-generated merges", () => {
    assert.match(promote, /push:[\s\S]*branches:\s*\[preview\]/);
    assert.match(promote, /workflow_call:/);
    assert.match(promote, /git config user\.name/);
    assert.match(promote, /git merge --no-ff origin\/preview/);
    assert.match(promote, /git push origin HEAD:nightly/);
    assert.match(promote, /promoted=true/);
  });

  it("deploys Pages explicitly after promotion instead of relying on a token-generated push event", () => {
    assert.match(promote, /needs:\s*promote/);
    assert.match(promote, /needs\.promote\.outputs\.promoted == 'true'/);
    assert.match(promote, /uses:\s*\.\/\.github\/workflows\/deploy-pages\.yml/);
    assert.match(promote, /ref:\s*nightly/);
    assert.match(promote, /secrets:\s*inherit/);
  });

  it("chains promotion directly from the preview automerge workflow", () => {
    assert.match(automerge, /pages:\s*write/);
    assert.match(automerge, /id-token:\s*write/);
    assert.match(automerge, /needs:\s*automerge/);
    assert.match(automerge, /uses:\s*\.\/\.github\/workflows\/promote-preview\.yml/);
    assert.match(automerge, /secrets:\s*inherit/);
  });
});
