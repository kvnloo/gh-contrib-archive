import { contentRevision as stableRevision } from "./resource-revision.ts";
import fs from "node:fs";

export const SEMANTIC_GRAPH_SCHEMA = 1 as const;

export type SemanticConceptConfig = {
  id: string;
  query: string;
};

export type SemanticHotsetRepo = {
  repo: string;
  alias: string;
  sha: string | null;
  lastActivityAt: string | null;
  activityCount: number;
  status: "indexed" | "clone_failed" | "analyze_failed";
};

export type SemanticRepoHit = {
  repo: string;
  processCount: number;
  definitionCount: number;
  symbolCount: number;
  topProcesses: string[];
  topFiles: string[];
};

export type SemanticConcept = SemanticConceptConfig & {
  repos: SemanticRepoHit[];
};

export type SemanticRepoLink = {
  source: string;
  target: string;
  sharedConcepts: string[];
  weight: number;
};

export type PublicSemanticGraph = {
  schemaVersion: typeof SEMANTIC_GRAPH_SCHEMA;
  privacy: "public-safe";
  source: "gitnexus" | "unavailable";
  gitnexusVersion: string | null;
  embeddings: boolean;
  revision: string;
  hotset: SemanticHotsetRepo[];
  concepts: SemanticConcept[];
  repoLinks: SemanticRepoLink[];
};

type Json = Record<string, any>;

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))].sort();
}

export function projectGitNexusResult(repo: string, raw: Json): SemanticRepoHit | null {
  const processes = Array.isArray(raw.processes) ? raw.processes : [];
  const definitions = Array.isArray(raw.definitions) ? raw.definitions : [];
  const symbols = Array.isArray(raw.process_symbols) ? raw.process_symbols : [];
  if (processes.length === 0 && definitions.length === 0 && symbols.length === 0) return null;

  const topProcesses = uniqueStrings(
    processes
      .slice(0, 5)
      .map(
        (item: Json) =>
          item.summary ??
          item.heuristicLabel ??
          item.name ??
          item.label ??
          item.id,
      ),
  );
  const topFiles = uniqueStrings(
    [...symbols, ...definitions]
      .slice(0, 30)
      .map((item: Json) => item.filePath ?? item.file_path),
  );

  return {
    repo,
    processCount: processes.length,
    definitionCount: definitions.length,
    symbolCount: symbols.length,
    topProcesses,
    topFiles,
  };
}

export function compileSemanticGraph(args: {
  gitnexusVersion: string;
  embeddings: boolean;
  hotset: SemanticHotsetRepo[];
  concepts: SemanticConceptConfig[];
  results: Map<string, Map<string, Json>>;
}): PublicSemanticGraph {
  const concepts: SemanticConcept[] = args.concepts.map((concept) => {
    const repos: SemanticRepoHit[] = [];
    for (const repo of args.hotset) {
      const raw = args.results.get(repo.repo)?.get(concept.id);
      if (!raw) continue;
      const hit = projectGitNexusResult(repo.repo, raw);
      if (hit) repos.push(hit);
    }
    repos.sort(
      (a, b) =>
        b.processCount + b.definitionCount - (a.processCount + a.definitionCount) ||
        a.repo.localeCompare(b.repo),
    );
    return { ...concept, repos };
  });

  const pairConcepts = new Map<string, Set<string>>();
  for (const concept of concepts) {
    const repos = concept.repos.map((item) => item.repo).sort();
    for (let i = 0; i < repos.length; i += 1) {
      for (let j = i + 1; j < repos.length; j += 1) {
        const key = `${repos[i]}\0${repos[j]}`;
        const shared = pairConcepts.get(key) ?? new Set<string>();
        shared.add(concept.id);
        pairConcepts.set(key, shared);
      }
    }
  }

  const repoLinks: SemanticRepoLink[] = [...pairConcepts.entries()]
    .map(([key, values]) => {
      const [source, target] = key.split("\0");
      const sharedConcepts = [...values].sort();
      return {
        source,
        target,
        sharedConcepts,
        weight: sharedConcepts.length,
      };
    })
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        a.source.localeCompare(b.source) ||
        a.target.localeCompare(b.target),
    );

  const stable = {
    schemaVersion: SEMANTIC_GRAPH_SCHEMA,
    privacy: "public-safe" as const,
    source: "gitnexus" as const,
    gitnexusVersion: args.gitnexusVersion,
    embeddings: args.embeddings,
    hotset: [...args.hotset].sort((a, b) => a.repo.localeCompare(b.repo)),
    concepts,
    repoLinks,
  };

  return {
    ...stable,
    revision: stableRevision(stable),
  };
}

export function emptySemanticGraph(): PublicSemanticGraph {
  const stable = {
    schemaVersion: SEMANTIC_GRAPH_SCHEMA,
    privacy: "public-safe" as const,
    source: "unavailable" as const,
    gitnexusVersion: null,
    embeddings: false,
    hotset: [],
    concepts: [],
    repoLinks: [],
  };
  return { ...stable, revision: stableRevision(stable) };
}

export function readSemanticGraph(filePath: string): PublicSemanticGraph {
  if (!fs.existsSync(filePath)) return emptySemanticGraph();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as PublicSemanticGraph;
    if (
      parsed.schemaVersion !== SEMANTIC_GRAPH_SCHEMA ||
      parsed.privacy !== "public-safe" ||
      !Array.isArray(parsed.hotset) ||
      !Array.isArray(parsed.concepts) ||
      !Array.isArray(parsed.repoLinks)
    ) {
      return emptySemanticGraph();
    }
    return parsed;
  } catch {
    return emptySemanticGraph();
  }
}

function objectRow(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Json
    : null;
}

function nonnegativeCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function metadataStrings(value: unknown, limit: number): string[] {
  return uniqueStrings(Array.isArray(value) ? value : []).slice(0, limit);
}

export function filterSemanticGraph(
  graph: PublicSemanticGraph,
  allowedRepos: ReadonlySet<string>,
): PublicSemanticGraph {
  if (!graph || graph.schemaVersion !== SEMANTIC_GRAPH_SCHEMA || graph.privacy !== "public-safe") {
    return emptySemanticGraph();
  }
  // Treat the persisted snapshot as untrusted. Filtering identities alone is not
  // sufficient: explicitly project each nested record before public export.
  const hotset = (Array.isArray(graph.hotset) ? graph.hotset : []).flatMap((value): SemanticHotsetRepo[] => {
    const row = objectRow(value);
    if (!row || !allowedRepos.has(row.repo) ||
        !["indexed", "clone_failed", "analyze_failed"].includes(row.status)) return [];
    return [{
      repo: row.repo,
      alias: typeof row.alias === "string" ? row.alias : row.repo.replace("/", "__"),
      sha: typeof row.sha === "string" ? row.sha : null,
      lastActivityAt: typeof row.lastActivityAt === "string" ? row.lastActivityAt : null,
      activityCount: nonnegativeCount(row.activityCount),
      status: row.status,
    }];
  });
  const concepts = (Array.isArray(graph.concepts) ? graph.concepts : []).flatMap((value): SemanticConcept[] => {
    const row = objectRow(value);
    if (!row || typeof row.id !== "string" || typeof row.query !== "string") return [];
    const repos = (Array.isArray(row.repos) ? row.repos : []).flatMap((value: unknown): SemanticRepoHit[] => {
      const hit = objectRow(value);
      if (!hit || !allowedRepos.has(hit.repo)) return [];
      return [{
        repo: hit.repo,
        processCount: nonnegativeCount(hit.processCount),
        definitionCount: nonnegativeCount(hit.definitionCount),
        symbolCount: nonnegativeCount(hit.symbolCount),
        topProcesses: metadataStrings(hit.topProcesses, 5),
        topFiles: metadataStrings(hit.topFiles, 30),
      }];
    });
    return [{ id: row.id, query: row.query, repos }];
  });
  const repoLinks = (Array.isArray(graph.repoLinks) ? graph.repoLinks : []).flatMap((value): SemanticRepoLink[] => {
    const row = objectRow(value);
    if (!row || !allowedRepos.has(row.source) || !allowedRepos.has(row.target)) return [];
    const sharedConcepts = metadataStrings(row.sharedConcepts, concepts.length);
    return [{ source: row.source, target: row.target, sharedConcepts, weight: sharedConcepts.length }];
  });
  const stable = {
    schemaVersion: SEMANTIC_GRAPH_SCHEMA,
    privacy: "public-safe" as const,
    source: graph.source === "gitnexus" ? "gitnexus" as const : "unavailable" as const,
    gitnexusVersion: typeof graph.gitnexusVersion === "string" ? graph.gitnexusVersion : null,
    embeddings: graph.embeddings === true,
    hotset,
    concepts,
    repoLinks,
  };
  return { ...stable, revision: stableRevision(stable) };
}
