import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const deploy = readFileSync(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");
const nightly = readFileSync(new URL("../.github/workflows/automerge-nightly.yml", import.meta.url), "utf8");

describe("Pages deployment from main", () => {
  it("refreshes, validates, mirrors, and deploys hourly from the default branch", () => {
    assert.match(deploy, /branches:\s*\[main\]/);
    assert.match(deploy, /schedule:[\s\S]*cron:\s*"17 \* \* \* \*"/);
    assert.match(deploy, /workflow_dispatch:/);
    assert.doesNotMatch(deploy, /workflow_call:/);
    assert.match(deploy, /if:\s*github\.ref == 'refs\/heads\/main'/);
    assert.match(deploy, /actions\/checkout@v4[\s\S]*ref:\s*\$\{\{\s*github\.sha\s*\}\}/);
    assert.match(deploy, /permissions:[\s\S]*contents:\s*write/);
    assert.match(deploy, /Restore bounded covered-inbox cache/);
    assert.match(deploy, /\.cache\/covered-attention\.json/);
    assert.match(deploy, /Refresh complete public work inventory/);
    assert.match(deploy, /npm run inbox:public-sync/);
    assert.match(deploy, /GH_INBOX_TOKEN/);
    assert.doesNotMatch(deploy, /npm run inbox:sync/);
    assert.match(deploy, /inventoryComplete/);
    assert.match(deploy, /missing repository materialization/);
    assert.match(deploy, /run: npm test/);
    assert.match(deploy, /run: npm run build/);
    assert.match(deploy, /run: npm run dogfood:api/);
    assert.match(deploy, /npm run eval:api -- --require-export/);
    assert.match(deploy, /Publish connector-readable API snapshot[\s\S]*READ_CACHE_BRANCH:\s*read-cache[\s\S]*bash scripts\/publish-read-cache\.sh/);
    assert.match(deploy, /public\/release\.json/);
    assert.match(deploy, /api\/v1\/attention\.json/);
    assert.match(deploy, /actions\/configure-pages@v5/);
    assert.match(deploy, /actions\/upload-pages-artifact@v4/);
    assert.match(deploy, /path:\s*\.\/out/);
    assert.match(deploy, /environment:[\s\S]*name:\s*github-pages/);
    assert.match(deploy, /actions\/deploy-pages@v4/);
    assert.match(deploy, /Verify deployed covered inbox/);
    assert.doesNotMatch(deploy, /archive-pages/);
    assert.doesNotMatch(deploy, /gods-eye-view|bilawalsidhu/);
  });

  it("does not deploy from the nightly automerge workflow", () => {
    assert.doesNotMatch(nightly, /pages:\s*write/);
    assert.doesNotMatch(nightly, /id-token:\s*write/);
    assert.doesNotMatch(nightly, /deploy-pages\.yml/);
  });
});
