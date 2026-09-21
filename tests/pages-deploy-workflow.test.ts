import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const workflowPath = new URL("../.github/workflows/deploy-pages.yml", import.meta.url);

describe("Pages deployment workflow", () => {
  it("deploys the tested static export from nightly with least-required Pages permissions", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    assert.match(workflow, /branches:\s*\[nightly\]/);
    assert.match(workflow, /contents:\s*read/);
    assert.match(workflow, /pages:\s*write/);
    assert.match(workflow, /id-token:\s*write/);
    assert.match(workflow, /NEXT_PUBLIC_BASE_PATH:\s*\/gh-contrib-archive/);
    assert.match(workflow, /actions\/configure-pages@v5/);
    assert.match(workflow, /actions\/upload-pages-artifact@v4/);
    assert.match(workflow, /path:\s*\.\/out/);
    assert.match(workflow, /actions\/deploy-pages@v4/);
  });
});
