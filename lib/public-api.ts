import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  openAttentionDb,
  readAttentionRecords,
  readAttentionSyncedAt,
} from "./attention-db.ts";
import type { AttentionRecord } from "./attention.ts";
import {
  compilePublicSnapshot,
  type PublicArchiveItem,
  type PublicArchive,
} from "./public-snapshot.ts";
import {
  readThreadEventsSeed,
  type PublicThreadEvent,
} from "./public-thread-events.ts";
import { buildWorkQueues, type WorkQueueName } from "./work-queues.ts";
import { buildRecentThreads, type RecentThread } from "./recent-threads.ts";
import {
  actorHref,
  buildActorIndex,
  type PublicActorIndexRow,
  type PublicActorResource,
} from "./actor-index.ts";
import {
  filterSemanticGraph,
  readSemanticGraph,
  type PublicSemanticGraph,
} from "./semantic-graph.ts";

export const PUBLIC_API_SCHEMA = 1 as const;

export type PublicAttentionItem = Omit<AttentionRecord, "repoVisibility">;

export type PublicApiIndex = {
  schemaVersion: typeof PUBLIC_API_SCHEMA;
  privacy: "public-safe";
  kind: "github-materialized-read-api";
  generatedAt: string;
  sources: {
    archiveUpdatedAt: string;
    attentionUpdatedAt: string | null;
  };
  endpoints: {
    index: string;
    queues: string;
    recent: string;
    actors: string;
    actor: string;
    semantic: string;
    attention: string;
    contributions: string;
    repos: string;
    repo: string;
    thread: string;
  };
  guarantees: string[];
};

export type PublicAttention = {
  schemaVersion: typeof PUBLIC_API_SCHEMA;
  privacy: "public-safe";
  updatedAt: string | null;
  count: number;
  items: PublicAttentionItem[];
};

export type PublicWorkQueues = {
  schemaVersion: typeof PUBLIC_API_SCHEMA;
  privacy: "public-safe";
  updatedAt: string | null;
  counts: Record<WorkQueueName, number>;
  queues: Record<WorkQueueName, PublicAttentionItem[]>;
};

export type PublicRecentThreads = {
  schemaVersion: typeof PUBLIC_API_SCHEMA;
  privacy: "public-safe";
  generatedAt: string;
  count: number;
  items: RecentThread[];
};

export type PublicActors = {
  schemaVersion: typeof PUBLIC_API_SCHEMA;
  privacy: "public-safe";
  count: number;
  actors: PublicActorIndexRow[];
};

export type PublicRepoIndex = {
  schemaVersion: typeof PUBLIC_API_SCHEMA;
  privacy: "public-safe";
  count: number;
  repos: {
    repo: string;
    contributions: number;
    attention: number;
    href: string;
  }[];
};

type PublicRepoResource = {
  schemaVersion: typeof PUBLIC_API_SCHEMA;
  privacy: "public-safe";
  repo: string;
  contributions: PublicArchiveItem[];
  attention: PublicAttentionItem[];
};

type PublicThreadResource = {
  schemaVersion: typeof PUBLIC_API_SCHEMA;
  privacy: "public-safe";
  repo: string;
  number: number;
  contributions: PublicArchiveItem[];
  attention: PublicAttentionItem[];
  events: PublicThreadEvent[];
  eventsUpdatedAt: string | null;
  eventSourceUpdatedAt: string | null;
};

export type CompiledPublicApi = {
  index: PublicApiIndex;
  queues: PublicWorkQueues;
  recent: PublicRecentThreads;
  actors: PublicActors;
  semantic: PublicSemanticGraph;
  attention: PublicAttention;
  contributions: PublicArchive;
  repos: PublicRepoIndex;
  repoResources: Map<string, PublicRepoResource>;
  threadResources: Map<string, PublicThreadResource>;
  actorResources: Map<string, PublicActorResource>;
};

function laterIso(a: string, b: string | null): string {
  return b && b > a ? b : a;
}

function publicAttentionItem(record: AttentionRecord): PublicAttentionItem {
  const { repoVisibility: _repoVisibility, ...safe } = record;
  return safe;
}

function safeRepoSegments(repo: string): [string, string] | null {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repo);
  if (!match || match[1] === "." || match[1] === ".." || match[2] === "." || match[2] === "..") {
    return null;
  }
  return [match[1], match[2]];
}

function readAttentionSeed(attentionDbPath: string): {
  updatedAt: string | null;
  records: AttentionRecord[];
} {
  const seedPath = path.join(path.dirname(attentionDbPath), "attention-seed.json");
  if (!fs.existsSync(seedPath)) return { updatedAt: null, records: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(seedPath, "utf8")) as {
      updatedAt?: unknown;
      items?: unknown;
    };
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const records = rawItems.filter((item): item is AttentionRecord => {
      if (!item || typeof item !== "object") return false;
      const row = item as Record<string, unknown>;
      return (
        row.repoVisibility === "public" &&
        typeof row.repo === "string" &&
        safeRepoSegments(row.repo) !== null &&
        typeof row.number === "number" &&
        typeof row.title === "string" &&
        typeof row.url === "string" &&
        typeof row.priority === "string" &&
        typeof row.blocker === "string" &&
        typeof row.nextAction === "string" &&
        typeof row.updatedAt === "string"
      );
    });
    return {
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      records,
    };
  } catch {
    return { updatedAt: null, records: [] };
  }
}

function readPublicAttention(attentionDbPath: string): {
  updatedAt: string | null;
  records: AttentionRecord[];
} {
  if (!fs.existsSync(attentionDbPath)) return readAttentionSeed(attentionDbPath);
  let db: DatabaseSync | null = null;
  try {
    db = openAttentionDb(attentionDbPath);
    const records = readAttentionRecords(db, 10000).filter(
      (record) => record.repoVisibility === "public" && safeRepoSegments(record.repo) !== null,
    );
    if (records.length === 0) {
      const seed = readAttentionSeed(attentionDbPath);
      if (seed.records.length > 0) return seed;
    }
    return {
      updatedAt: readAttentionSyncedAt(db),
      records,
    };
  } finally {
    db?.close();
  }
}

export function compilePublicApi(
  publicDbPath: string,
  attentionDbPath: string,
): CompiledPublicApi {
  const snapshot = compilePublicSnapshot(publicDbPath);
  const attentionState = readPublicAttention(attentionDbPath);
  const threadEventsState = readThreadEventsSeed(
    path.join(path.dirname(attentionDbPath), "thread-events-seed.json"),
  );
  const attentionItems = attentionState.records.map(publicAttentionItem);

  const publicItems = snapshot.archive.items.filter(
    (item): item is Extract<PublicArchiveItem, { visibility: "public" }> =>
      item.visibility === "public",
  );

  const allowedSemanticRepos = new Set(
    publicItems
      .map((item) => item.repo)
      .filter((repo): repo is string => typeof repo === "string"),
  );
  const semantic = filterSemanticGraph(
    readSemanticGraph(path.join(path.dirname(publicDbPath), "semantic-graph.json")),
    allowedSemanticRepos,
  );

  const itemsByRepo = new Map<string, PublicArchiveItem[]>();
  for (const item of publicItems) {
    if (!item.repo || safeRepoSegments(item.repo) === null) continue;
    const list = itemsByRepo.get(item.repo) ?? [];
    list.push(item);
    itemsByRepo.set(item.repo, list);
  }

  const attentionByRepo = new Map<string, PublicAttentionItem[]>();
  for (const item of attentionItems) {
    const list = attentionByRepo.get(item.repo) ?? [];
    list.push(item);
    attentionByRepo.set(item.repo, list);
  }

  const repoNames = new Set<string>([
    ...itemsByRepo.keys(),
    ...attentionByRepo.keys(),
  ]);

  const repoResources = new Map<string, PublicRepoResource>();
  const threadResources = new Map<string, PublicThreadResource>();
  const repoRows: PublicRepoIndex["repos"] = [];

  for (const repo of [...repoNames].sort()) {
    const contributions = itemsByRepo.get(repo) ?? [];
    const attention = attentionByRepo.get(repo) ?? [];
    repoResources.set(repo, {
      schemaVersion: PUBLIC_API_SCHEMA,
      privacy: "public-safe",
      repo,
      contributions,
      attention,
    });

    const [owner, name] = safeRepoSegments(repo)!;
    repoRows.push({
      repo,
      contributions: contributions.length,
      attention: attention.length,
      href: `repos/${owner}/${name}.json`,
    });

    const numbers = new Set<number>();
    for (const item of contributions) {
      if (item.visibility === "public" && item.number != null) numbers.add(item.number);
    }
    for (const item of attention) numbers.add(item.number);

    for (const number of [...numbers].sort((a, b) => a - b)) {
      const eventState = threadEventsState?.threads[`${repo}#${number}`] ?? null;
      threadResources.set(`${repo}#${number}`, {
        schemaVersion: PUBLIC_API_SCHEMA,
        privacy: "public-safe",
        repo,
        number,
        contributions: contributions.filter(
          (item) => item.visibility === "public" && item.number === number,
        ),
        attention: attention.filter((item) => item.number === number),
        events: eventState?.events ?? [],
        eventsUpdatedAt: eventState ? threadEventsState?.updatedAt ?? null : null,
        eventSourceUpdatedAt: eventState?.sourceUpdatedAt ?? null,
      });
    }
  }

  const actorState = buildActorIndex(
    [...threadResources.values()].map((thread) => ({
      repo: thread.repo,
      number: thread.number,
      events: thread.events,
    })),
  );
  const actors: PublicActors = {
    schemaVersion: PUBLIC_API_SCHEMA,
    privacy: "public-safe",
    count: actorState.rows.length,
    actors: actorState.rows,
  };

  const groupedQueues = buildWorkQueues(attentionItems);
  const queues: PublicWorkQueues = {
    schemaVersion: PUBLIC_API_SCHEMA,
    privacy: "public-safe",
    updatedAt: attentionState.updatedAt,
    counts: Object.fromEntries(
      Object.entries(groupedQueues).map(([name, items]) => [name, items.length]),
    ) as Record<WorkQueueName, number>,
    queues: groupedQueues,
  };

  const recentItems = buildRecentThreads(publicItems, attentionItems);
  const recent: PublicRecentThreads = {
    schemaVersion: PUBLIC_API_SCHEMA,
    privacy: "public-safe",
    generatedAt: laterIso(snapshot.manifest.lastCheckedAt, attentionState.updatedAt),
    count: recentItems.length,
    items: recentItems,
  };

  const attention: PublicAttention = {
    schemaVersion: PUBLIC_API_SCHEMA,
    privacy: "public-safe",
    updatedAt: attentionState.updatedAt,
    count: attentionItems.length,
    items: attentionItems,
  };

  const repos: PublicRepoIndex = {
    schemaVersion: PUBLIC_API_SCHEMA,
    privacy: "public-safe",
    count: repoRows.length,
    repos: repoRows,
  };

  const index: PublicApiIndex = {
    schemaVersion: PUBLIC_API_SCHEMA,
    privacy: "public-safe",
    kind: "github-materialized-read-api",
    generatedAt: laterIso(snapshot.manifest.lastCheckedAt, attentionState.updatedAt),
    sources: {
      archiveUpdatedAt: snapshot.manifest.lastCheckedAt,
      attentionUpdatedAt: attentionState.updatedAt,
    },
    endpoints: {
      index: "index.json",
      queues: "queues.json",
      recent: "recent.json",
      actors: "actors.json",
      actor: "actors/{login}.json",
      semantic: "semantic.json",
      attention: "attention.json",
      contributions: "contributions.json",
      repos: "repos.json",
      repo: "repos/{owner}/{repo}.json",
      thread: "threads/{owner}/{repo}/{number}.json",
    },
    guarantees: [
      "read-only static JSON",
      "whitelisted projected schemas only",
      "private and unknown repository identities excluded from repo/thread/attention endpoints",
      "no GitHub credential or raw notification/review/comment body is published",
    ],
  };

  return {
    index,
    queues,
    recent,
    actors,
    semantic,
    attention,
    contributions: snapshot.archive,
    repos,
    repoResources,
    threadResources,
    actorResources: actorState.resources,
  };
}

export function writePublicApi(
  publicDbPath: string,
  attentionDbPath: string,
  outputRoot: string,
) {
  const compiled = compilePublicApi(publicDbPath, attentionDbPath);
  const root = path.join(outputRoot, "api", "v1");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });

  const writeJson = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
  };

  writeJson(path.join(root, "index.json"), compiled.index);
  writeJson(path.join(root, "queues.json"), compiled.queues);
  writeJson(path.join(root, "recent.json"), compiled.recent);
  writeJson(path.join(root, "actors.json"), compiled.actors);
  writeJson(path.join(root, "semantic.json"), compiled.semantic);
  writeJson(path.join(root, "attention.json"), compiled.attention);
  writeJson(path.join(root, "contributions.json"), compiled.contributions);
  writeJson(path.join(root, "repos.json"), compiled.repos);

  for (const [login, resource] of compiled.actorResources) {
    writeJson(path.join(root, actorHref(login)), resource);
  }

  for (const [repo, resource] of compiled.repoResources) {
    const segments = safeRepoSegments(repo);
    if (!segments) continue;
    const [owner, name] = segments;
    writeJson(path.join(root, "repos", owner, `${name}.json`), resource);
  }

  for (const [key, resource] of compiled.threadResources) {
    const separator = key.lastIndexOf("#");
    const repo = key.slice(0, separator);
    const segments = safeRepoSegments(repo);
    if (!segments) continue;
    const [owner, name] = segments;
    writeJson(
      path.join(root, "threads", owner, name, `${resource.number}.json`),
      resource,
    );
  }

  return compiled;
}
