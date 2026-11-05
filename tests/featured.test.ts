import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FEATURED, drilldown, featuredBySlug } from "../lib/featured.ts";

const now = new Date("2026-11-05T00:00:00Z");
const pub = (o: Record<string, unknown>) => ({
  visibility: "public", body_chars: 1, excerpt: null, updated_at: null, flags: [], state: null, ...o,
}) as never;

const items = [
  pub({ id: "1", type: "pull_request", repo: "trycua/cua", number: 10, title: "fresh PR", url: "https://github.com/trycua/cua/pull/10", state: "OPEN", created_at: "2026-11-01T00:00:00Z" }),
  pub({ id: "2", type: "issue", repo: "trycua/cua", number: 11, title: "stale issue", url: "https://github.com/trycua/cua/issues/11", state: "OPEN", created_at: "2026-08-01T00:00:00Z" }),
  pub({ id: "3", type: "issue", repo: "trycua/cua", number: 12, title: "fresh issue", url: "https://github.com/trycua/cua/issues/12", state: "OPEN", created_at: "2026-11-02T00:00:00Z" }),
  pub({ id: "4", type: "comment", repo: "trycua/cua", number: 10, title: "fresh PR", url: "https://github.com/trycua/cua/pull/10#issuecomment-1", created_at: "2026-11-03T00:00:00Z" }),
  pub({ id: "5", type: "comment", repo: "trycua/cua", number: 50, title: "someone else's issue", url: "https://github.com/trycua/cua/issues/50#issuecomment-2", created_at: "2026-10-30T00:00:00Z" }),
  pub({ id: "6", type: "pull_request", repo: "trycua/cua", number: 9, title: "merged PR", url: "https://github.com/trycua/cua/pull/9", state: "MERGED", created_at: "2025-03-01T00:00:00Z" }),
  pub({ id: "7", type: "pull_request", repo: "other/repo", number: 1, title: "not featured", url: "https://github.com/other/repo/pull/1", state: "OPEN", created_at: "2026-11-01T00:00:00Z" }),
  { id: "8", type: "comment", visibility: "private", created_at: "2026-11-01T00:00:00Z" } as never,
];

describe("featured repos", () => {
  it("lists Kevin's six pinned repos with a theme from each project's site", () => {
    assert.deepEqual(FEATURED.map((f) => f.slug), ["hermes-agent", "cua", "oh-my-pi", "gods-eye-view", "noctalia", "noop"]);
    for (const f of FEATURED) assert.ok(f.theme.accent && f.theme.bg && f.themeSource, f.slug);
    assert.deepEqual(featuredBySlug("gods-eye-view")?.repos, ["bilawalsidhu/gods-eye-view", "kvnloo/gods-eye-view"]);
  });

  it("puts fresh open work first, PRs before issues, stale last", () => {
    const d = drilldown(items, ["trycua/cua"], now);
    assert.deepEqual(d.inProgress.map((t) => t.number), [10, 12, 11]);
    assert.equal(d.inProgress[0].myEvents, 2, "the PR and Kevin's comment on it are one thread");
    assert.equal(d.inProgress[2].stale, true);
  });

  it("separates recent conversations from finished work and ignores private and other repos", () => {
    const d = drilldown(items, ["trycua/cua"], now);
    assert.deepEqual(d.recent.map((t) => t.number), [50]);
    assert.deepEqual(d.past, [{ year: "2025", threads: [d.past[0].threads[0]] }]);
    assert.equal(d.past[0].threads[0].number, 9);
    assert.deepEqual(d.totals, { all: 6, prs: 2, merged: 1, openPrs: 1, issues: 2, comments: 2, reviews: 0 });
  });
});
