import fs from "node:fs";
import path from "node:path";

export const PUBLIC_THREAD_EVENTS_SCHEMA = 1 as const;

export type PublicThreadEvent = {
  id: string;
  actor: string;
  actorType: string | null;
  kind: "comment" | "review";
  at: string;
  url: string | null;
  reviewState: string | null;
  authorAssociation: string | null;
};

export type PublicThreadEvents = {
  repo: string;
  number: number;
  sourceUpdatedAt: string;
  events: PublicThreadEvent[];
};

export type PublicThreadEventsSeed = {
  schemaVersion: typeof PUBLIC_THREAD_EVENTS_SCHEMA;
  privacy: "public-safe";
  updatedAt: string;
  threads: Record<string, PublicThreadEvents>;
};

type Json = Record<string, any>;

function event(
  kind: PublicThreadEvent["kind"],
  item: Json,
): PublicThreadEvent | null {
  const actor = String(item.user?.login ?? item.author?.login ?? "");
  const at = String(
    kind === "review"
      ? item.submitted_at ?? item.submittedAt ?? ""
      : item.created_at ?? item.createdAt ?? "",
  );
  const id = String(item.id ?? "");
  if (!actor || !at || !id) return null;
  return {
    id,
    actor,
    actorType:
      item.user?.type == null && item.author?.type == null
        ? null
        : String(item.user?.type ?? item.author?.type),
    kind,
    at,
    url:
      item.html_url == null && item.url == null
        ? null
        : String(item.html_url ?? item.url),
    reviewState:
      kind === "review" && item.state != null ? String(item.state) : null,
    authorAssociation:
      item.author_association == null && item.authorAssociation == null
        ? null
        : String(item.author_association ?? item.authorAssociation),
  };
}

export function publicThreadEventsFromRest(
  comments: Json[],
  reviews: Json[],
): PublicThreadEvent[] {
  return [
    ...comments.map((item) => event("comment", item)),
    ...reviews.map((item) => event("review", item)),
  ]
    .filter((item): item is PublicThreadEvent => item !== null)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

function validEvent(value: unknown): value is PublicThreadEvent {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.actor === "string" &&
    (row.kind === "comment" || row.kind === "review") &&
    typeof row.at === "string"
  );
}

export function readThreadEventsSeed(filePath: string): PublicThreadEventsSeed | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<PublicThreadEventsSeed>;
    if (
      parsed.schemaVersion !== PUBLIC_THREAD_EVENTS_SCHEMA ||
      parsed.privacy !== "public-safe" ||
      typeof parsed.updatedAt !== "string" ||
      !parsed.threads ||
      typeof parsed.threads !== "object"
    ) {
      return null;
    }
    const threads: Record<string, PublicThreadEvents> = {};
    for (const [key, value] of Object.entries(parsed.threads)) {
      if (!value || typeof value !== "object") continue;
      const row = value as Partial<PublicThreadEvents>;
      if (
        typeof row.repo !== "string" ||
        typeof row.number !== "number" ||
        typeof row.sourceUpdatedAt !== "string" ||
        !Array.isArray(row.events)
      ) {
        continue;
      }
      threads[key] = {
        repo: row.repo,
        number: row.number,
        sourceUpdatedAt: row.sourceUpdatedAt,
        events: row.events.filter(validEvent),
      };
    }
    return {
      schemaVersion: PUBLIC_THREAD_EVENTS_SCHEMA,
      privacy: "public-safe",
      updatedAt: parsed.updatedAt,
      threads,
    };
  } catch {
    return null;
  }
}

export function writeThreadEventsSeed(
  filePath: string,
  threads: Map<string, PublicThreadEvents>,
  updatedAt: string,
) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const value: PublicThreadEventsSeed = {
    schemaVersion: PUBLIC_THREAD_EVENTS_SCHEMA,
    privacy: "public-safe",
    updatedAt,
    threads: Object.fromEntries(
      [...threads.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}
