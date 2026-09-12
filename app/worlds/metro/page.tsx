"use client";

import dynamic from "next/dynamic";
import { WorldChrome } from "@/components/worlds/WorldChrome";
import { useWorldGraph } from "@/components/worlds/useWorldGraph";

const MetroScene = dynamic(() => import("@/components/worlds/metro/Scene"), { ssr: false });

function MetroHud() {
  const jst = new Date().toLocaleTimeString("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <div className="pointer-events-none absolute left-4 top-20 z-10 max-w-xs sm:left-6 sm:top-24">
      <div className="relative border border-cyan-500/30 bg-black/40 p-4 backdrop-blur-sm">
        <span className="absolute -left-px -top-px h-3 w-3 border-l-2 border-t-2 border-cyan-400" />
        <span className="absolute -right-px -top-px h-3 w-3 border-r-2 border-t-2 border-cyan-400" />
        <span className="absolute -bottom-px -left-px h-3 w-3 border-b-2 border-l-2 border-cyan-400" />
        <span className="absolute -bottom-px -right-px h-3 w-3 border-b-2 border-r-2 border-cyan-400" />
        <p className="text-2xl font-bold tracking-wider text-white">METRO</p>
        <p className="mt-0.5 text-[10px] uppercase tracking-[0.25em] text-zinc-400">Tokyo • 3D network view</p>
        <div className="mt-4 space-y-1.5 font-mono text-[10px] text-zinc-500">
          <p>CAM 01 / 08</p>
          <p className="flex items-center gap-2 text-zinc-300">
            <span>YAMANOTE LOOP</span>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
            <span>{jst} JST</span>
          </p>
          <p className="flex items-center gap-2 text-zinc-300">
            <span>TRANSIT LINES ACTIVE</span>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee]" />
          </p>
        </div>
      </div>
      <p className="mt-3 text-center text-[10px] uppercase tracking-[0.2em] text-fuchsia-400/90">
        ↻ Yamanote line (loop)
      </p>
    </div>
  );
}

export default function Page() {
  const graph = useWorldGraph();

  return (
    <WorldChrome title="Metro">
      {graph ? (
        <>
          <MetroScene graph={graph} />
          <MetroHud />
        </>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-zinc-500">
          Loading public-safe graph…
        </div>
      )}
    </WorldChrome>
  );
}
