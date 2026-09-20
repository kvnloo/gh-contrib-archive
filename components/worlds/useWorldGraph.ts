"use client";

import { publicAssetPath } from "@/lib/public-path";
import { useEffect, useState } from "react";

export type Graph = {
  login: string;
  nodes: Record<string, unknown>[];
  edges: { source: string; target: string; kind: string }[];
  lights: { month: string; visibility: string; n: number }[];
  commits: { year: number; repo: string | null; visibility: string; count: number; url: string | null }[];
  orgs: { org: string; n: number }[];
  repos: { repo: string; n: number }[];
};

let cache: Graph | null = null;

export function useWorldGraph() {
  const [graph, setGraph] = useState<Graph | null>(cache);
  useEffect(() => {
    if (cache) return;
    fetch(publicAssetPath("/world-graph.json"))
      .then((r) => r.json())
      .then((g: Graph) => {
        cache = g;
        setGraph(g);
      });
  }, []);
  return graph;
}
