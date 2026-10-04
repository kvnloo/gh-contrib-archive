import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalJson, contentRevision, prettyJsonBytes } from "../lib/resource-revision.ts";

describe("resource revisions", () => {
  it("is stable across object key order while preserving array order", () => {
    const a = { z: 1, nested: { b: 2, a: 1 }, rows: ["a", "b"] };
    const b = { rows: ["a", "b"], nested: { a: 1, b: 2 }, z: 1 };
    assert.equal(canonicalJson(a), canonicalJson(b));
    assert.equal(contentRevision(a), contentRevision(b));
    assert.notEqual(contentRevision(a), contentRevision({ ...b, rows: ["b", "a"] }));
  });

  it("reports the exact emitted pretty JSON byte size", () => {
    const value = { hello: "world" };
    assert.equal(prettyJsonBytes(value), Buffer.byteLength(JSON.stringify(value, null, 2) + "\n"));
  });
});
