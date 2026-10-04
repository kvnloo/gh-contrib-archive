import fs from "node:fs";
import path from "node:path";
import type { AttentionRecord } from "./attention.ts";

export const PUBLIC_ATTENTION_CACHE_SCHEMA = 2 as const;
export const PUBLIC_ATTENTION_CLASSIFIER_VERSION = 1 as const;

export type AttentionCacheEvent = {
  id: string;
  kind: "comment" | "review";
  actor: string;
  actorType?: string | null;
  authorAssociation?: string | null;
  at: string;
  reviewState: string | null;
  url: string | null;
};

// Re-project cached metadata: an extra field must never become public feedback text.
export function projectAttentionEvents(value: unknown): AttentionCacheEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((event): AttentionCacheEvent[] => {
    if (!event || typeof event !== "object" || typeof event.id !== "string" ||
        (event.kind !== "comment" && event.kind !== "review") ||
        typeof event.actor !== "string" || typeof event.at !== "string") return [];
    const actorTypes = ["User", "Bot", "Organization", "Mannequin"];
    const associations = ["COLLABORATOR", "CONTRIBUTOR", "FIRST_TIMER", "FIRST_TIME_CONTRIBUTOR", "MANNEQUIN", "MEMBER", "NONE", "OWNER"];
    return [{
      ...(actorTypes.includes(event.actorType) ? { actorType: event.actorType } : {}),
      ...(associations.includes(event.authorAssociation) ? { authorAssociation: event.authorAssociation } : {}),
      id: event.id, kind: event.kind, actor: event.actor, at: event.at,
      reviewState: typeof event.reviewState === "string" ? event.reviewState : null,
      url: typeof event.url === "string" && event.url.startsWith("https://github.com/") ? event.url : null }];
  }).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

export type AttentionCacheEntry = {
  sourceUpdatedAt: string;
  depth: "shallow" | "deep";
  record: AttentionRecord;
  events: AttentionCacheEvent[];
};

type AttentionCacheFile = {
  schemaVersion: typeof PUBLIC_ATTENTION_CACHE_SCHEMA;
  classifierVersion: number;
  savedAt: string;
  items: Record<string, AttentionCacheEntry>;
};

function validRecord(value: unknown): value is AttentionRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.repoVisibility === "public" &&
    typeof row.repo === "string" &&
    typeof row.number === "number" &&
    typeof row.title === "string" &&
    typeof row.url === "string" &&
    typeof row.priority === "string" &&
    typeof row.blocker === "string" &&
    typeof row.nextAction === "string" &&
    typeof row.updatedAt === "string" &&
    typeof row.ciState === "string"
  );
}

function validEntry(value: unknown): value is AttentionCacheEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.sourceUpdatedAt === "string" &&
    (row.depth === "shallow" || row.depth === "deep") &&
    Array.isArray(row.events) &&
    validRecord(row.record)
  );
}

export function readAttentionCache(
  filePath: string,
  classifierVersion = PUBLIC_ATTENTION_CLASSIFIER_VERSION,
): Map<string, AttentionCacheEntry> {
  if (!fs.existsSync(filePath)) return new Map();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<AttentionCacheFile>;
    if (
      parsed.schemaVersion !== PUBLIC_ATTENTION_CACHE_SCHEMA ||
      parsed.classifierVersion !== classifierVersion ||
      !parsed.items ||
      typeof parsed.items !== "object"
    ) {
      return new Map();
    }
    return new Map(
      Object.entries(parsed.items).filter((entry): entry is [string, AttentionCacheEntry] =>
        validEntry(entry[1]),
      ).map(([key, entry]): [string, AttentionCacheEntry] => [key, { ...entry, events: projectAttentionEvents(entry.events) }]),
    );
  } catch {
    return new Map();
  }
}

export function writeAttentionCache(
  filePath: string,
  entries: Map<string, AttentionCacheEntry>,
  savedAt: string,
  classifierVersion = PUBLIC_ATTENTION_CLASSIFIER_VERSION,
) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const value: AttentionCacheFile = {
    schemaVersion: PUBLIC_ATTENTION_CACHE_SCHEMA,
    classifierVersion,
    savedAt,
    items: Object.fromEntries([...entries.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, { ...entry, events: projectAttentionEvents(entry.events) }])),
  };
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function canReuseAttention(
  entry: AttentionCacheEntry | undefined,
  sourceUpdatedAt: string,
  commentCount: number,
) {
  if (!entry || entry.sourceUpdatedAt !== sourceUpdatedAt) return false;
  return commentCount <= 0 || entry.depth === "deep";
}
