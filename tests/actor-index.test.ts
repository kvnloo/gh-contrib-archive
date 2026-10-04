import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actorHref, buildActorIndex } from "../lib/actor-index.ts";

describe("actor index", () => {
  it("aggregates public event history by actor across threads", () => {
    const result = buildActorIndex([
      {
        repo: "example/one",
        number: 7,
        events: [
          {
            id: "1",
            actor: "maintainer",
            actorType: "User",
            kind: "comment",
            at: "2026-10-03T18:00:00Z",
            url: null,
            reviewState: null,
            authorAssociation: "MEMBER",
          },
          {
            id: "2",
            actor: "maintainer",
            actorType: "User",
            kind: "review",
            at: "2026-10-03T19:00:00Z",
            url: null,
            reviewState: "APPROVED",
            authorAssociation: "MEMBER",
          },
        ],
      },
      {
        repo: "example/two",
        number: 9,
        events: [
          {
            id: "3",
            actor: "maintainer",
            actorType: "User",
            kind: "review",
            at: "2026-10-03T20:00:00Z",
            url: null,
            reviewState: "COMMENTED",
            authorAssociation: "COLLABORATOR",
          },
        ],
      },
    ]);

    const actor = result.resources.get("maintainer");
    assert.equal(actor?.eventCount, 3);
    assert.equal(actor?.comments, 1);
    assert.equal(actor?.reviews, 2);
    assert.equal(actor?.threadCount, 2);
    assert.equal(actor?.repoCount, 2);
    assert.deepEqual(actor?.authorAssociations, {
      COLLABORATOR: 1,
      MEMBER: 2,
    });
    assert.equal(actor?.threads[0]?.repo, "example/two");
  });

  it("uses URL-safe actor shard names", () => {
    assert.equal(actorHref("dependabot[bot]"), "actors/dependabot%5Bbot%5D.json");
  });
});
