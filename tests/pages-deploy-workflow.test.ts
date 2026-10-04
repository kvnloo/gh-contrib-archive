import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const deploy = readFileSync(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");
const nightly = readFileSync(new URL("../.github/workflows/automerge-nightly.yml", import.meta.url), "utf8");
const sync = readFileSync(new URL("../.github/workflows/sync-archive.yml", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("default-branch API release", () => {
  it("refreshes on main pushes, an hourly schedule, and explicit dispatch", () => {
    assert.match(deploy, /push:\s*\n\s*branches:\s*\[main\]/);
    assert.match(deploy, /schedule:\s*\n\s*- cron: "17 \* \* \* \*"/);
    assert.match(deploy, /workflow_dispatch:/);
    assert.match(deploy, /workflow_call:/);
    assert.match(deploy, /default: main/);
  });

  it("prevents preview or nightly callers from publishing the production site", () => {
    assert.match(deploy, /if: github\.ref == 'refs\/heads\/main' && \(inputs\.ref == '' \|\| inputs\.ref == 'main'\)/);
    assert.match(deploy, /deploy:\s*\n\s*needs: build/);
    assert.doesNotMatch(nightly, /deploy-pages\.yml/);
  });

  it("pins ordinary builds to the event SHA and records the actual checkout", () => {
    assert.match(deploy, /ref: \$\{\{ inputs\.ref \|\| github\.sha \}\}/);
    assert.match(deploy, /git rev-parse HEAD/);
    assert.match(deploy, /public\/release\.json/);
    assert.match(deploy, /EVAL_HEAD_SHA: \$\{\{ steps\.source\.outputs\.sha \}\}/);
  });

  it("collects before export and retains all release gates", () => {
    assert.ok(deploy.indexOf("npm run inbox:public-sync") < deploy.indexOf("run: npm run build"));
    for (const command of ["npm ci", "npm test", "npm run build", "npm run dogfood:api", "npm run eval:api -- --require-export"]) {
      assert.ok(deploy.includes(command), command);
    }
    assert.match(deploy, /NEXT_PUBLIC_BASE_PATH: \/gh-contrib-archive/);
    assert.match(deploy, /environment:[\s\S]*name: archive-pages/);
    assert.match(deploy, /actions\/configure-pages@v5/);
    assert.match(deploy, /actions\/upload-pages-artifact@v4/);
    assert.match(deploy, /path: \.\/out/);
    assert.match(deploy, /actions\/deploy-pages@v4/);
  });

  it("explicitly republishes after token-generated archive updates", () => {
    assert.match(sync, /if: github\.ref == 'refs\/heads\/main'/);
    assert.match(sync, /deploy:\s*\n\s*needs: sync/);
    assert.match(sync, /uses: \.\/\.github\/workflows\/deploy-pages\.yml/);
    assert.match(sync, /ref: main/);
    assert.match(sync, /secrets: inherit/);
    assert.match(sync, /pages: write/);
    assert.match(sync, /id-token: write/);
  });

  it("preserves both archive sync and API scripts during branch convergence", () => {
    assert.equal(pkg.scripts["sync:incremental"], "tsx scripts/sync-incremental.ts");
    assert.equal(pkg.scripts.prebuild, "npm run export:public && npm run export:api");
    assert.equal(pkg.scripts["dogfood:api"], "node scripts/dogfood-api.mjs");
    assert.equal(pkg.scripts["eval:api"], "node --experimental-strip-types scripts/eval-api.ts");
  });
});
