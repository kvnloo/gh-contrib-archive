import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/visual-fidelity.yml", import.meta.url),
  "utf8",
);

describe("blind visual artifact boundary", () => {
  it("keeps mapping and named candidate/reference diagnostics out of the blind artifact", () => {
    const blindStart = workflow.indexOf("name: Upload blind-only packet");
    const revealStart = workflow.indexOf("name: Upload reveal diagnostics separately");
    assert.ok(blindStart >= 0);
    assert.ok(revealStart > blindStart);

    const blindBlock = workflow.slice(blindStart, revealStart);
    assert.match(blindBlock, /visual\/blind-a\.jpg/);
    assert.match(blindBlock, /visual\/blind-b\.jpg/);
    assert.match(blindBlock, /visual\/blind-metrics\.json/);
    assert.doesNotMatch(blindBlock, /reveal\.json/);
    assert.doesNotMatch(blindBlock, /candidate\.png/);
    assert.doesNotMatch(blindBlock, /candidate-preview/);
    assert.doesNotMatch(blindBlock, /reference-preview/);
    assert.doesNotMatch(blindBlock, /diagnostics\.json/);
  });

  it("puts mapping and candidate-specific diagnostics in the separate reveal artifact", () => {
    const revealStart = workflow.indexOf("name: Upload reveal diagnostics separately");
    const revealJob = workflow.indexOf("\n  reveal:", revealStart);
    assert.ok(revealStart >= 0);
    assert.ok(revealJob > revealStart);

    const block = workflow.slice(revealStart, revealJob);
    assert.match(block, /mycelium-visual-reveal/);
    assert.match(block, /visual\/reveal\.json/);
    assert.match(block, /visual\/diagnostics\.json/);
    assert.match(block, /visual\/candidate\.png/);
  });
});
