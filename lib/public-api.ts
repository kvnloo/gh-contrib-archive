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
import { contentRevision, prettyJsonBytes } from "./resource-revision.ts";

export const PUBLIC_API_SCHEMA = 1 as const;

export type PublicAttentionItem = Omit<AttentionRecord, "repoVisibility">;
type PublicContribution = Extract<PublicArchiveItem, { visibility: "public" }>;

export type PublicResourceDescriptor = {
  href: string;
  revision: string;
  updatedAt: string | null;
  bytes: number;
};

export type PublicApiIndex = {
  schemaVersion: typeof PUBLIC_API_SCHEMA;
  privacy: "public-safe";
  kind: "github-materialized-read-api";
  revision: string;
  generatedAt: string;
  sources: {
    archiveUpdatedAt: string;
    attentionUpdatedAt: string | null;
  };
  endpoints: {
    index: string;
    changes: string;
    attention: string;
    contributions: string;
    repos: string;
    repo: string;
    thread: string;
  };
  resources: {
    changes: PublicResourceDescriptor;
    attention: PublicResourceDescriptor;
    contributions: PublicResourceDescriptor;
    repos: PublicResourceDescriptor;
  };
  cache: {
    validation: "content-revision";
    algorithm: "sha256-canonical-json";
    flow: string[];
  };
  guarantees: string[];
};

export type PublicAttention = {
  schemaVersion: typeof PUBLIC_API_SCHEMA;
  privacy: "public-safe";
  revision: string;
  updatedAt: string | null;
  count: number;
  items: PublicAttentionItem[];
};

export type PublicContributions = PublicArchive & {
  revision: string;
};

export type PublicThreadDescriptor = {
  number: number;
  href: string;
  revision: string;
  updatedAt: string | null;
  priority: PublicAttentionItem["priority"] | null;
};

export type PublicRepoIndex = {
  schemaVersion: typeof PUBLIC_API_SCHEMA;
  privacy: "public-safe";
  revision: string;
  count: number;
  repos: {
    repo: string;
    contributions: number;
    attention: number;
    href: string;
    revision: string;
    updatedAt: string | null;
    bytes: number;
  }[];
};

export type PublicRepoResource = {
  schemaVersion: typeof PUBLIC_API_SCHEMA;
  privacy: "public-safe";
  kind: "repo-context";
  revision: string;
  repo: string;
  updatedAt: string | null;
  contributions: PublicContribution[];
  attention: PublicAttentionItem[];
  threads: PublicThreadDescriptor[];
};

export type PublicThreadResource = {
  schemaVersion: typeof PUBLIC_API_SCHEMA;
  privacy: "public-safe";
  kind: "thread-context";
  revision: string;
  repo: string;
  number: number;
  identity: { repo: string; number: number };
  title: string | null;
  url: string | null;
  state: string | null;
  updatedAt: string | null;
  derived: null | {
    priority: PublicAttentionItem["priority"];
    blocker: string;
    nextAction: string;
    ciState: PublicAttentionItem["ciState"];
    reviewDecision: string | null;
    mergeState: string | null;
    lastExternalAt: string | null;
    lastSelfAt: string | null;
  };
  contributions: PublicContribution[];
  attention: PublicAttentionItem[];
  evidenceRefs: string[];
  links: {
    self: string;
    repo: string;
  };
};

export type PublicChanges = {
  schemaVersion: typeof PUBLIC_API_SCHEMA;
  privacy: "public-safe";
  kind: "resource-revision-manifest";
  revision: string;
  generatedAt: string;
  resources: {
    attention: PublicResourceDescriptor;
    contributions: PublicResourceDescriptor;
    repos: PublicResourceDescriptor;
  };
  repos: PublicRepoIndex["repos"];
};

export type CompiledPublicApi = {
  index: PublicApiIndex;
  changes: PublicChanges;
  attention: PublicAttention;
  contributions: PublicContributions;
  repos: PublicRepoIndex;
  repoResources: Map<string, PublicRepoResource>;
  threadResources: Map<string, PublicThreadResource>;
};

function laterIso(a: string, b: string | null): string {
  return b && b > a ? b : a;
}

function latestIso(values: Array<string | null | undefined>): string | null {
  const present = values.filter((value): value is string => typeof value === "string" && value.length > 0);
  return present.length === 0
    ? null
    : present.reduce((latest, value) => (value > latest ? value : latest));
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

function resourceDescriptor(
  href: string,
  resource: { revision: string },
  updatedAt: string | null,
): PublicResourceDescriptor {
  return {
    href,
    revision: resource.revision,
    updatedAt,
    bytes: prettyJsonBytes(resource),
  };
}

function stableArchivePayload(archive: PublicArchive) {
  const { generatedAt: _generatedAt, ...stable } = archive;
  return stable;
}

function buildThreadResource(
  repo: string,
  number: number,
  contributions: PublicContribution[],
  attention: PublicAttentionItem[],
): PublicThreadResource {
  const [owner, name] = safeRepoSegments(repo)!;
  const root = contributions.find((item) =>
    ["pull_request", "issue", "discussion"].includes(item.type),
  );
  const primaryAttention = attention[0] ?? null;
  const updatedAt = latestIso([
    ...contributions.map((item) => item.updated_at ?? item.created_at),
    ...attention.map((item) => item.updatedAt),
  ]);
  const derived = primaryAttention
    ? {
        priority: primaryAttention.priority,
        blocker: primaryAttention.blocker,
        nextAction: primaryAttention.nextAction,
        ciState: primaryAttention.ciState,
        reviewDecision: primaryAttention.reviewDecision,
        mergeState: primaryAttention.mergeState,
        lastExternalAt: primaryAttention.lastExternalAt,
        lastSelfAt: primaryAttention.lastSelfAt,
      }
    : null;
  const base = {
    schemaVersion: PUBLIC_API_SCHEMA,
    privacy: "public-safe" as const,
    kind: "thread-context" as const,
    repo,
    number,
    identity: { repo, number },
    title: root?.title ?? primaryAttention?.title ?? null,
    url: root?.url ?? primaryAttention?.url ?? null,
    state: root?.state ?? null,
    updatedAt,
    derived,
    contributions,
    attention,
    evidenceRefs: [
      ...contributions.map((item) => item.id),
      ...(primaryAttention ? [`attention:${repo}#${number}`] : []),
    ],
    links: {
      self: `threads/${owner}/${name}/${number}.json`,
      repo: `repos/${owner}/${name}.json`,
    },
  };
  return { ...base, revision: contentRevision(base) };
}

export function compilePublicApi(
  publicDbPath: string,
  attentionDbPath: string,
): CompiledPublicApi {
  const snapshot = compilePublicSnapshot(publicDbPath);
  const attentionState = readPublicAttention(attentionDbPath);
  const attentionItems = attentionState.records.map(publicAttentionItem);

  const publicItems = snapshot.archive.items.filter(
    (item): item is PublicContribution => item.visibility === "public",
  );

  const itemsByRepo = new Map<string, PublicContribution[]>();
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
    const [owner, name] = safeRepoSegments(repo)!;

    const numbers = new Set<number>();
    for (const item of contributions) {
      if (item.number != null) numbers.add(item.number);
    }
    for (const item of attention) numbers.add(item.number);

    const threads: PublicThreadDescriptor[] = [];
    for (const number of [...numbers].sort((a, b) => a - b)) {
      const resource = buildThreadResource(
        repo,
        number,
        contributions.filter((item) => item.number === number),
        attention.filter((item) => item.number === number),
      );
      threadResources.set(`${repo}#${number}`, resource);
      threads.push({
        number,
        href: resource.links.self,
        revision: resource.revision,
        updatedAt: resource.updatedAt,
        priority: resource.derived?.priority ?? null,
      });
    }

    const updatedAt = latestIso([
      ...contributions.map((item) => item.updated_at ?? item.created_at),
      ...attention.map((item) => item.updatedAt),
    ]);
    const repoBase = {
      schemaVersion: PUBLIC_API_SCHEMA,
      privacy: "public-safe" as const,
      kind: "repo-context" as const,
      repo,
      updatedAt,
      contributions,
      attention,
      threads,
    };
    const repoResource: PublicRepoResource = {
      ...repoBase,
      revision: contentRevision(repoBase),
    };
    repoResources.set(repo, repoResource);

    repoRows.push({
      repo,
      contributions: contributions.length,
      attention: attention.length,
      href: `repos/${owner}/${name}.json`,
      revision: repoResource.revision,
      updatedAt,
      bytes: prettyJsonBytes(repoResource),
    });
  }

  const attentionBase = {
    schemaVersion: PUBLIC_API_SCHEMA,
    privacy: "public-safe" as const,
    count: attentionItems.length,
    items: attentionItems,
  };
  const attention: PublicAttention = {
    ...attentionBase,
    revision: contentRevision(attentionBase),
    updatedAt: attentionState.updatedAt,
  };

  const contributions: PublicContributions = {
    ...snapshot.archive,
    revision: contentRevision(stableArchivePayload(snapshot.archive)),
  };

  const reposBase = {
    schemaVersion: PUBLIC_API_SCHEMA,
    privacy: "public-safe" as const,
    count: repoRows.length,
    repos: repoRows,
  };
  const repos: PublicRepoIndex = {
    ...reposBase,
    revision: contentRevision(reposBase),
  };

  const generatedAt = laterIso(snapshot.manifest.lastCheckedAt, attentionState.updatedAt);
  const coreResources = {
    attention: resourceDescriptor("attention.json", attention, attentionState.updatedAt),
    contributions: resourceDescriptor(
      "contributions.json",
      contributions,
      snapshot.manifest.lastCheckedAt,
    ),
    repos: resourceDescriptor("repos.json", repos, generatedAt),
  };
  const changesBase = {
    schemaVersion: PUBLIC_API_SCHEMA,
    privacy: "public-safe" as const,
    kind: "resource-revision-manifest" as const,
    generatedAt,
    resources: coreResources,
    repos: repoRows,
  };
  const changes: PublicChanges = {
    ...changesBase,
    revision: contentRevision({
      ...changesBase,
      generatedAt: undefined,
      resources: Object.fromEntries(
        Object.entries(coreResources).map(([key, value]) => [
          key,
          { href: value.href, revision: value.revision },
        ]),
      ),
      repos: repoRows.map(({ repo, href, revision }) => ({ repo, href, revision })),
    }),
  };

  const endpoints = {
    index: "index.json",
    changes: "changes.json",
    attention: "attention.json",
    contributions: "contributions.json",
    repos: "repos.json",
    repo: "repos/{owner}/{repo}.json",
    thread: "threads/{owner}/{repo}/{number}.json",
  };
  const resources = {
    changes: resourceDescriptor("changes.json", changes, generatedAt),
    ...coreResources,
  };
  const cache = {
    validation: "content-revision" as const,
    algorithm: "sha256-canonical-json" as const,
    flow: [
      "fetch index.json",
      "compare the desired resource revision with the locally cached revision",
      "fetch only resources whose revision changed",
      "descend from repos.json to repo context, then to thread context only when needed",
    ],
  };
  const guarantees = [
    "read-only static JSON",
    "whitelisted projected schemas only",
    "private and unknown repository identities excluded from repo/thread/attention endpoints",
    "no GitHub credential or raw notification/review/comment body is published",
    "resource revisions ignore collector-only freshness timestamps and change with public semantic payloads",
  ];
  const indexStable = {
    schemaVersion: PUBLIC_API_SCHEMA,
    privacy: "public-safe" as const,
    kind: "github-materialized-read-api" as const,
    endpoints,
    resources: Object.fromEntries(
      Object.entries(resources).map(([key, value]) => [
        key,
        { href: value.href, revision: value.revision },
      ]),
    ),
    cache,
    guarantees,
  };
  const index: PublicApiIndex = {
    schemaVersion: PUBLIC_API_SCHEMA,
    privacy: "public-safe",
    kind: "github-materialized-read-api",
    revision: contentRevision(indexStable),
    generatedAt,
    sources: {
      archiveUpdatedAt: snapshot.manifest.lastCheckedAt,
      attentionUpdatedAt: attentionState.updatedAt,
    },
    endpoints,
    resources,
    cache,
    guarantees,
  };

  return {
    index,
    changes,
    attention,
    contributions,
    repos,
    repoResources,
    threadResources,
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
  writeJson(path.join(root, "changes.json"), compiled.changes);
  writeJson(path.join(root, "attention.json"), compiled.attention);
  writeJson(path.join(root, "contributions.json"), compiled.contributions);
  writeJson(path.join(root, "repos.json"), compiled.repos);

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
