import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const deploy = readFileSync(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");
const nightly = readFileSync(new URL("../.github/workflows/automerge-nightly.yml", import.meta.url), "utf8");

describe("Pages deployment from main", () => {
  it("builds the static export and deploys only main to github-pages", () => {
    assert.match(deploy, /branches:\s*\[main\]/);
    assert.match(deploy, /workflow_dispatch:/);
    assert.doesNotMatch(deploy, /workflow_call:/);
    assert.match(deploy, /if:\s*github\.ref == 'refs\/heads\/main'/);
    assert.match(deploy, /actions\/checkout@v4[\s\S]*ref:\s*\$\{\{\s*github\.sha\s*\}\}/);
    assert.match(deploy, /NEXT_PUBLIC_BASE_PATH:\s*\/gh-contrib-archive/);
    assert.match(deploy, /run: npm test/);
    assert.match(deploy, /run: npm run build/);
    assert.match(deploy, /public\/release\.json/);
    assert.match(deploy, /actions\/configure-pages@v5/);
    assert.match(deploy, /actions\/upload-pages-artifact@v4/);
    assert.match(deploy, /path:\s*\.\/out/);
    assert.match(deploy, /environment:[\s\S]*name:\s*github-pages/);
    assert.match(deploy, /actions\/deploy-pages@v4/);
    assert.doesNotMatch(deploy, /archive-pages/);
    assert.doesNotMatch(deploy, /verify-live/);
  });

  it("does not deploy from the nightly promotion workflow", () => {
    assert.doesNotMatch(nightly, /pages:\s*write/);
    assert.doesNotMatch(nightly, /id-token:\s*write/);
    assert.doesNotMatch(nightly, /deploy-pages\.yml/);
  });
});
