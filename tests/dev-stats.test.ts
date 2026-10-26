import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDevStats } from "../lib/dev-stats.ts";
import type { PublicArchive } from "../lib/public-snapshot.ts";
import type { PublicUpstreamLandingArchive } from "../lib/upstream-landings.ts";

const AS_OF = "2026-10-26T12:00:00.000Z";

function archive(
  items: unknown[] = [],
  commitBuckets: unknown[] = [],
): PublicArchive {
  return { items, commitBuckets, byRepo: [] } as unknown as PublicArchive;
}

function upstream(commits: unknown[] = []): PublicUpstreamLandingArchive {
  return {
    verifiedOn: "2026-10-18",
    repositories: {
      "NousResearch/hermes-agent": { commits },
      "omacom/omarchy": { commits: [] },
    },
  } as unknown as PublicUpstreamLandingArchive;
}

describe("public-safe dev velocity", () => {
  it("separates yearly commits from event velocity, public merge state, and anonymous issues", () => {
    const result = buildDevStats(
      archive([
        { id: "a", type: "pull_request", state: "MERGED", visibility: "public", created_at: "2026-10-25T11:00:00Z" },
        { id: "b", type: "issue", visibility: "private", created_at: "2026-10-24T11:00:00Z", repo: "SECRET/PRIVATE-REPO" },
        { id: "c", type: "comment", visibility: "public", created_at: "2026-10-22T11:00:00Z" },
        { id: "d", type: "issue", visibility: "public", created_at: "2026-10-01T11:00:00Z" },
        { id: "e", type: "review", visibility: "public", created_at: "2026-09-10T11:00:00Z" },
        { id: "f", type: "pull_request", state: "MERGED", visibility: "private", created_at: "2026-10-25T11:00:00Z" },
        { id: "g", type: "comment", visibility: "public", created_at: "2026-10-27T11:00:00Z" },
      ], [
        { year: 2026, visibility: "public", commit_count: 12, repo: "public/repo" },
        { year: 2026, visibility: "private", commit_count: 7, repo: null },
      ]),
      upstream(),
      AS_OF,
    );

    assert.equal(result.publicCommits, 12);
    assert.equal(result.privateCommits, 7);
    assert.equal(result.mergedPublicPRs, 1);
    assert.equal(result.publicPRs, 1);
    assert.equal(result.issuesCreated, 2);
    assert.equal(result.last28dEvents, 5); // includes anonymous private PR event, not future event
    assert.equal(result.previous28dEvents, 1);
    assert.equal(result.velocityPerWeek, 1.3);
    assert.equal(result.last7dEvents, 4);
    assert.equal(result.eventStreakDays, 2);
    assert.equal(result.activeDays28d, 4);
    assert.equal(result.mix.find((row) => row.category === "Issues")?.n, 2);
    assert.equal(result.weeks.length, 12);
    assert.equal(JSON.stringify(result).includes("SECRET/PRIVATE-REPO"), false);
  });

  it("counts only uniquely proven cherry-picks and consolidated commits, not review credit", () => {
    const sha = "a".repeat(40);
    const other = "b".repeat(40);
    const make = (id: string, landing: string, source: object = {}) => ({
      sha: id,
      url: "https://github.com/NousResearch/hermes-agent/commit/" + id,
      title: "An upstream commit",
      at: "2026-10-10T00:00:00Z",
      landing,
      credit: "author",
      ...source,
    });
    const result = buildDevStats(archive(), upstream([
      make(sha, "cherry-picked", { sourceCommitSha: "f".repeat(40) }),
      make(sha, "cherry-picked", { sourceCommitSha: "f".repeat(40) }),
      make(other, "maintainer-consolidated", { sourcePRs: [128180] }),
      make("c".repeat(40), "maintainer-consolidated"),
      make("d".repeat(40), "credited-upstream", { sourcePRs: [123] }),
      make("e".repeat(40), "author-attributed", { sourceCommitSha: "1".repeat(40) }),
    ]), AS_OF);

    assert.equal(result.verifiedSalvagedCommits, 2);
    assert.equal(result.salvageTrackedRepos, 2);
    assert.equal(result.salvageCoverageDate, "2026-10-18");
    assert.deepEqual(new Set(result.salvaged.map((commit) => commit.sha)), new Set([sha, other]));
  });

  it("has honest empty-baseline behavior and no fake personal best", () => {
    const result = buildDevStats(archive(), upstream(), AS_OF);
    assert.equal(result.velocityPerWeek, 0);
    assert.equal(result.eventStreakDays, 0);
    assert.equal(result.velocityChangePct, null);
    assert.equal(result.recordWeek, false);
    assert.equal(result.weeks.reduce((n, week) => n + week.n, 0), 0);
    assert.equal(result.mergedPublicPRs, 0);
  });

  it("only awards a 12-week record when this week beats every prior week", () => {
    const result = buildDevStats(archive([
      { type: "comment", visibility: "public", created_at: "2026-10-25T00:00:00Z" },
      { type: "comment", visibility: "public", created_at: "2026-10-24T00:00:00Z" },
      { type: "comment", visibility: "public", created_at: "2026-09-30T00:00:00Z" },
    ]), upstream(), AS_OF);
    assert.equal(result.recordWeek, true);
    assert.equal(result.last7dEvents, 2);
  });
});
