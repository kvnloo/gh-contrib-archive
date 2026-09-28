import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextDay, pageIsOlderThan, searchDay, splitDay, watermarkFrom } from "../lib/incremental.ts";

describe("incremental archive window", () => {
  it("backs up two days from the committed high-water mark", () => {
    const watermark = watermarkFrom("2026-09-11T22:45:19Z", Date.parse("2026-09-28T00:00:00Z"));
    assert.equal(watermark, "2026-09-09T22:45:19.000Z");
    assert.equal(searchDay(watermark), "2026-09-09");
  });

  it("accepts the sqlite ingested_at format", () => {
    const watermark = watermarkFrom("2026-09-11 23:12:00", Date.parse("2026-09-28T00:00:00Z"));
    assert.equal(searchDay(watermark), "2026-09-09");
  });

  it("refuses to start a full historical ingest when the database has no mark", () => {
    assert.throws(() => watermarkFrom(null), /refusing a full historical ingest/);
  });

  it("stops a newest-first page once every stamp is older than the window", () => {
    assert.equal(pageIsOlderThan(["2026-09-08T00:00:00Z", "2026-09-01T00:00:00Z"], "2026-09-09T00:00:00Z"), true);
    assert.equal(pageIsOlderThan(["2026-09-08T00:00:00Z", "2026-09-10T00:00:00Z"], "2026-09-09T00:00:00Z"), false);
    assert.equal(pageIsOlderThan([null, undefined], "2026-09-09T00:00:00Z"), false);
  });

  it("splits a search window so a slice can stay under the 1000-result cap", () => {
    assert.equal(splitDay("2026-09-09", "2026-09-28"), "2026-09-18");
    assert.equal(nextDay("2026-09-18"), "2026-09-19");
    assert.equal(splitDay("2026-09-09", "2026-09-10"), null);
  });
});
