import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/semantic-gitnexus.yml", import.meta.url),
  "utf8",
);
const script = readFileSync(
  new URL("../scripts/gitnexus-semantic.ts", import.meta.url),
  "utf8",
);

describe("GitNexus semantic refresh", () => {
  it("is manual-only until the optional integration is validated", () => {
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /schedule:/);
  });

  it("pins GitNexus and indexes clones without mutating source trees", () => {
    assert.match(workflow, /gitnexus@1\.6\.12/);
    assert.match(script, /"analyze", clonePath, "--index-only", "--name", alias/);
    assert.match(script, /GITNEXUS_NO_UPDATE_NOTIFIER/);
  });

  it("queries without source-content retention and deploys only changed snapshots", () => {
    assert.match(script, /"query",\s*concept\.query/);
    assert.doesNotMatch(script, /"--content"/);
    assert.match(workflow, /git diff --cached --quiet/);
    assert.match(workflow, /uses:\s*\.\/\.github\/workflows\/deploy-pages\.yml/);
    assert.match(workflow, /ref:\s*nightly/);
  });
});
