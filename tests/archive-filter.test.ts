import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterArchiveItems, pageArchiveItems } from "../lib/archive-filter.ts";

const items = [
  {
    id: "pub:1",
    type: "issue",
    visibility: "public" as const,
    url: "https://github.com/example/repo/issues/1",
    repo: "example/repo",
    number: 1,
    title: "Fix latency regression",
    excerpt: "Measure the slow startup path.",
    body_chars: 30,
    state: "OPEN",
    created_at: "2026-09-20T01:00:00Z",
    updated_at: "2026-09-20T02:00:00Z",
    flags: [{ code: "very_short", severity: "info", detail: "short" }],
  },
  {
    id: "private:abc",
    type: "issue",
    visibility: "private" as const,
    created_at: "2026-09-19T01:00:00Z",
  },
  {
    id: "pub:2",
    type: "comment",
    visibility: "public" as const,
    url: "https://github.com/other/repo/issues/2#issuecomment-1",
    repo: "other/repo",
    number: 2,
    title: "Router discussion",
    excerpt: "Public comment text",
    body_chars: 20,
    state: null,
    created_at: "2025-01-02T01:00:00Z",
    updated_at: null,
    flags: [],
  },
];

describe("archive filtering", () => {
  it("keeps private rows available to non-content filters", () => {
    assert.deepEqual(
      filterArchiveItems(items, { type: "issue", year: "2026" }).map((item) => item.id),
      ["pub:1", "private:abc"],
    );
  });

  it("never lets private rows satisfy repo, text, or flag searches", () => {
    assert.deepEqual(filterArchiveItems(items, { repo: "repo" }).map((item) => item.id), ["pub:1", "pub:2"]);
    assert.deepEqual(filterArchiveItems(items, { q: "latency" }).map((item) => item.id), ["pub:1"]);
    assert.deepEqual(filterArchiveItems(items, { flag: "very_short" }).map((item) => item.id), ["pub:1"]);
  });

  it("matches public text case-insensitively across public fields", () => {
    assert.deepEqual(filterArchiveItems(items, { q: "ROUTER" }).map((item) => item.id), ["pub:2"]);
    assert.deepEqual(filterArchiveItems(items, { q: "example/repo" }).map((item) => item.id), ["pub:1"]);
  });

  it("clamps paging and returns the filtered total", () => {
    const page = pageArchiveItems(items, {}, 99, 2);
    assert.equal(page.total, 3);
    assert.equal(page.page, 1);
    assert.deepEqual(page.items.map((item) => item.id), ["pub:2"]);
  });
});
