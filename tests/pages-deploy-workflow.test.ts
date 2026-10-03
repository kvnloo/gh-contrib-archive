import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const deploy = readFileSync(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");
const nightly = readFileSync(new URL("../.github/workflows/automerge-nightly.yml", import.meta.url), "utf8");

describe("Pages deployment after automated nightly promotion", () => {
  it("exposes the deploy workflow as a reusable workflow", () => {
    assert.match(deploy, /workflow_call:/);
    assert.match(deploy, /ref:/);
    assert.match(deploy, /actions\/checkout@v4[\s\S]*ref:\s*\$\{\{\s*inputs\.ref\s*\|\|\s*github\.ref_name\s*\}\}/);
  });

  it("uses a dedicated deployment environment for nightly Pages", () => {
    assert.match(deploy, /environment:\s*[\s\S]*name:\s*archive-pages/);
  });

  it("calls Pages deployment from the nightly promotion workflow after merge", () => {
    assert.match(nightly, /pages:\s*write/);
    assert.match(nightly, /id-token:\s*write/);
    assert.match(nightly, /needs:\s*automerge/);
    assert.match(nightly, /uses:\s*\.\/\.github\/workflows\/deploy-pages\.yml/);
    assert.match(nightly, /ref:\s*nightly/);
  });
});
