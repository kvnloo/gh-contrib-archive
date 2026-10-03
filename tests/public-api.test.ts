import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { openAttentionDb, replaceAttentionRecords } from "../lib/attention-db.ts";
import { openDb } from "../lib/db.ts";
import { writePublicApi } from "../lib/public-api.ts";
import { writeThreadEventsSeed } from "../lib/public-thread-events.ts";
import type { AttentionRecord } from "../lib/attention.ts";

function attention(
  repo: string,
  repoVisibility: AttentionRecord["repoVisibility"],
  number: number,
  overrides: Partial<AttentionRecord> = {},
): AttentionRecord {
  return {
    repo,
    repoVisibility,
    number,
    title: `PR ${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    priority: "P0",
    blocker: "verification_requested",
    nextAction: "run verification",
    updatedAt: "2026-10-03T18:00:00Z",
    lastExternalAt: "2026-10-03T18:00:00Z",
    lastSelfAt: null,
    ciState: "passing",
    reviewDecision: null,
    mergeState: "CLEAN",
    ...overrides,
  };
}

describe("public GitHub read API", () => {
  it("exports public resources and fails closed for private or unknown attention rows", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-public-api-"));
    const publicDbPath = path.join(root, "public.db");
    const attentionDbPath = path.join(root, "attention.db");
    const outputRoot = path.join(root, "public");

    const publicDb = openDb(publicDbPath);
    try {
      const insert = publicDb.prepare(
        `INSERT INTO contributions (
          id, github_node_id, type, url, html_url, repo, number, title, excerpt,
          body_chars, state, visibility, created_at, updated_at, ingested_at, extra_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insert.run(
        "public:1",
        "PUB1",
        "pull_request",
        "https://github.com/example/public-repo/pull/7",
        "https://github.com/example/public-repo/pull/7",
        "example/public-repo",
        7,
        "Public PR",
        "safe excerpt",
        12,
        "OPEN",
        "public",
        "2026-10-03T17:00:00Z",
        "2026-10-03T18:00:00Z",
        "2026-10-03T18:00:00Z",
        null,
      );
      insert.run(
        "private:1",
        "PRIV1",
        "pull_request",
        "https://github.com/secret/private-repo/pull/3",
        "https://github.com/secret/private-repo/pull/3",
        "secret/private-repo",
        3,
        "Private title",
        "PRIVATE BODY",
        12,
        "OPEN",
        "private",
        "2026-10-03T17:00:00Z",
        "2026-10-03T18:00:00Z",
        "2026-10-03T18:00:00Z",
        null,
      );
      publicDb.prepare(
        "INSERT INTO meta(key, value) VALUES('login', 'kvnloo')",
      ).run();
    } finally {
      publicDb.close();
    }

    const attentionDb = openAttentionDb(attentionDbPath);
    try {
      replaceAttentionRecords(
        attentionDb,
        [
          attention("example/public-repo", "public", 7),
          attention("secret/private-repo", "private", 3),
          attention("mystery/unknown-repo", "unknown", 9),
        ],
        "2026-10-03T18:05:00Z",
      );
    } finally {
      attentionDb.close();
    }

    writeThreadEventsSeed(
      path.join(root, "thread-events-seed.json"),
      new Map([
        [
          "example/public-repo#7",
          {
            repo: "example/public-repo",
            number: 7,
            sourceUpdatedAt: "2026-10-03T18:00:00Z",
            events: [
              {
                id: "event:1",
                actor: "maintainer",
                actorType: "User",
                kind: "review",
                at: "2026-10-03T18:01:00Z",
                url: "https://github.com/example/public-repo/pull/7#pullrequestreview-1",
                reviewState: "CHANGES_REQUESTED",
                authorAssociation: "MEMBER",
              },
            ],
          },
        ],
        [
          "secret/private-repo#3",
          {
            repo: "secret/private-repo",
            number: 3,
            sourceUpdatedAt: "2026-10-03T18:00:00Z",
            events: [
              {
                id: "event:private",
                actor: "private-maintainer",
                actorType: "User",
                kind: "comment",
                at: "2026-10-03T18:01:00Z",
                url: null,
                reviewState: null,
                authorAssociation: null,
              },
            ],
          },
        ],
      ]),
      "2026-10-03T18:05:00Z",
    );

    const api = writePublicApi(publicDbPath, attentionDbPath, outputRoot);

    assert.deepEqual(api.attention.items.map((item) => item.repo), ["example/public-repo"]);
    assert.equal(api.repoResources.has("secret/private-repo"), false);
    assert.equal(api.repoResources.has("mystery/unknown-repo"), false);
    assert.deepEqual(api.recent.items.map((item) => item.repo), ["example/public-repo"]);
    assert.equal(api.recent.items[0]?.href, "threads/example/public-repo/7.json");
    assert.deepEqual(api.actors.actors.map((actor) => actor.login), ["maintainer"]);

    const publicRepoFile = path.join(
      outputRoot,
      "api",
      "v1",
      "repos",
      "example",
      "public-repo.json",
    );
    const publicThreadFile = path.join(
      outputRoot,
      "api",
      "v1",
      "threads",
      "example",
      "public-repo",
      "7.json",
    );
    assert.equal(fs.existsSync(publicRepoFile), true);
    assert.equal(fs.existsSync(publicThreadFile), true);
    const thread = JSON.parse(fs.readFileSync(publicThreadFile, "utf8"));
    assert.equal(thread.events[0]?.actor, "maintainer");
    assert.equal(thread.events[0]?.reviewState, "CHANGES_REQUESTED");
    assert.equal(thread.eventsUpdatedAt, "2026-10-03T18:05:00Z");
    assert.equal(
      fs.existsSync(
        path.join(outputRoot, "api", "v1", "repos", "secret", "private-repo.json"),
      ),
      false,
    );

    const deployed = fs.readFileSync(
      path.join(outputRoot, "api", "v1", "contributions.json"),
      "utf8",
    );
    assert.equal(deployed.includes("PRIVATE BODY"), false);
    assert.equal(deployed.includes("Private title"), false);
    assert.equal(deployed.includes("secret/private-repo"), false);
    const recent = fs.readFileSync(
      path.join(outputRoot, "api", "v1", "recent.json"),
      "utf8",
    );
    assert.equal(recent.includes("secret/private-repo"), false);
    assert.equal(
      fs.readFileSync(publicThreadFile, "utf8").includes("private-maintainer"),
      false,
    );
    const actorFile = path.join(
      outputRoot,
      "api",
      "v1",
      "actors",
      "maintainer.json",
    );
    assert.equal(fs.existsSync(actorFile), true);
    assert.equal(fs.readFileSync(actorFile, "utf8").includes("private-maintainer"), false);
  });
  it("materializes action queues from public attention only", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-public-queues-"));
    const publicDbPath = path.join(root, "public.db");
    const attentionDbPath = path.join(root, "attention.db");
    const outputRoot = path.join(root, "public");

    const publicDb = openDb(publicDbPath);
    try {
      publicDb.prepare("INSERT INTO meta(key, value) VALUES('login', 'kvnloo')").run();
    } finally {
      publicDb.close();
    }

    const attentionDb = openAttentionDb(attentionDbPath);
    try {
      replaceAttentionRecords(
        attentionDb,
        [
          attention("example/action", "public", 1),
          attention("example/ready", "public", 2, {
            priority: "P1",
            blocker: "approved",
            nextAction: "surface for merge",
            reviewDecision: "APPROVED",
          }),
          attention("example/blocked", "public", 3, {
            priority: "P1",
            blocker: "ci_failed",
            nextAction: "fix CI",
            ciState: "failing",
          }),
          attention("example/waiting", "public", 4, {
            priority: "P2",
            blocker: "awaiting_review",
            nextAction: "wait for review",
          }),
          attention("example/superseded", "public", 5, {
            priority: "P1",
            blocker: "superseded_candidate",
            nextAction: "confirm replacement then close",
          }),
          attention("secret/private", "private", 6),
        ],
        "2026-10-03T18:05:00Z",
      );
    } finally {
      attentionDb.close();
    }

    const api = writePublicApi(publicDbPath, attentionDbPath, outputRoot);
    assert.deepEqual(api.queues.counts, {
      needs_action: 1,
      ready: 1,
      blocked: 1,
      waiting: 1,
      superseded: 1,
    });
    assert.deepEqual(api.queues.queues.ready.map((item) => item.repo), ["example/ready"]);
    assert.deepEqual(api.queues.queues.blocked.map((item) => item.repo), ["example/blocked"]);

    const deployed = fs.readFileSync(
      path.join(outputRoot, "api", "v1", "queues.json"),
      "utf8",
    );
    assert.equal(deployed.includes("secret/private"), false);
  });

  it("uses the tracked public-safe seed when the local attention database is absent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-public-api-seed-"));
    const publicDbPath = path.join(root, "public.db");
    const attentionDbPath = path.join(root, "attention.db");
    const outputRoot = path.join(root, "public");

    const publicDb = openDb(publicDbPath);
    try {
      publicDb.prepare("INSERT INTO meta(key, value) VALUES('login', 'kvnloo')").run();
    } finally {
      publicDb.close();
    }

    fs.writeFileSync(
      path.join(root, "attention-seed.json"),
      JSON.stringify({
        updatedAt: "2026-10-03T19:25:00Z",
        items: [
          attention("pingdotgg/t3code", "public", 13967),
          attention("secret/private-repo", "private", 3),
          attention("mystery/unknown-repo", "unknown", 9),
        ],
      }),
      "utf8",
    );

    const api = writePublicApi(publicDbPath, attentionDbPath, outputRoot);
    assert.deepEqual(api.attention.items.map((item) => item.repo), ["pingdotgg/t3code"]);
    assert.equal(api.attention.updatedAt, "2026-10-03T19:25:00Z");
    assert.equal(
      fs.existsSync(
        path.join(outputRoot, "api", "v1", "threads", "pingdotgg", "t3code", "13967.json"),
      ),
      true,
    );

    const deployed = fs.readFileSync(
      path.join(outputRoot, "api", "v1", "attention.json"),
      "utf8",
    );
    assert.equal(deployed.includes("secret/private-repo"), false);
    assert.equal(deployed.includes("mystery/unknown-repo"), false);
  });
});
