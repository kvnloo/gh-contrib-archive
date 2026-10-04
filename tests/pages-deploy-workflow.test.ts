import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const deploy = readFileSync(
  new URL("../.github/workflows/deploy-pages.yml", import.meta.url),
  "utf8",
);

describe("Pages deployment from main", () => {
  it("keeps scheduling on the default branch but delegates to the nightly publisher", () => {
    assert.match(deploy, /branches:\s*\[main\]/);
    assert.match(deploy, /schedule:/);
    assert.match(deploy, /cron:\s*"17 \* \* \* \*"/);
    assert.match(deploy, /workflow_dispatch:/);
    assert.match(
      deploy,
      /uses:\s*kvnloo\/gh-contrib-archive\/\.github\/workflows\/deploy-pages\.yml@nightly/,
    );
    assert.match(deploy, /ref:\s*nightly/);
    assert.match(deploy, /secrets:\s*inherit/);
  });

  it("does not contain a second build or Pages deploy implementation", () => {
    assert.doesNotMatch(deploy, /actions\/checkout@/);
    assert.doesNotMatch(deploy, /npm run build/);
    assert.doesNotMatch(deploy, /actions\/upload-pages-artifact@/);
    assert.doesNotMatch(deploy, /actions\/deploy-pages@/);
  });
});
