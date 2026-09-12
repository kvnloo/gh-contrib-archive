"use client";

import { useCallback, useState } from "react";
import { WorldChrome } from "@/components/worlds/WorldChrome";
import { useWorldGraph } from "@/components/worlds/useWorldGraph";
import NightScene, { type PublicHover } from "@/components/worlds/night/Scene";

const YEAR_MARKS = [2012, 2016, 2020, 2025, 2026] as const;
const YEAR_MIN = 2012;
const YEAR_MAX = 2026;

export default function Page() {
  const graph = useWorldGraph();
  const [year, setYear] = useState(2025);
  const [hover, setHover] = useState<PublicHover | null>(null);

  const onHover = useCallback((h: PublicHover | null) => setHover(h), []);

  return (
    <WorldChrome title="Black Marble">
      {graph ? (
        <>
          <NightScene graph={graph} year={year} onHover={onHover} />
          <div className="pointer-events-none absolute inset-x-0 top-[4.5rem] z-10 px-4 md:top-[5rem]">
            <div className="pointer-events-auto max-w-md">
              <div className="relative pt-2">
                <div className="h-px bg-zinc-600/80" />
                <div
                  className="absolute left-0 top-2 h-px bg-zinc-400"
                  style={{ width: `${((year - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100}%` }}
                />
                {YEAR_MARKS.map((y) => {
                  const pct = ((y - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100;
                  return (
                    <button
                      key={y}
                      type="button"
                      onClick={() => setYear(y)}
                      className="absolute top-0 -translate-x-1/2 text-[10px] tabular-nums text-zinc-500 hover:text-zinc-200"
                      style={{ left: `${pct}%` }}
                    >
                      {y}
                    </button>
                  );
                })}
                <input
                  type="range"
                  min={YEAR_MIN}
                  max={YEAR_MAX}
                  step={1}
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="absolute left-0 right-0 top-0 h-6 w-full cursor-pointer opacity-0"
                  aria-label="Scrub year"
                />
                <div
                  className="pointer-events-none absolute top-1.5 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.8)]"
                  style={{ left: `${((year - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100}%` }}
                />
              </div>
              <p className="mt-4 text-[10px] uppercase tracking-[0.25em] text-zinc-600">
                longitude = time · public lights named · private mass only
              </p>
            </div>
          </div>
          {hover && (
            <div
              className="pointer-events-none fixed z-30 max-w-xs -translate-x-1/2 -translate-y-full rounded-lg border border-white/10 bg-black/90 px-3 py-2 shadow-xl backdrop-blur-sm"
              style={{ left: hover.x, top: hover.y - 12 }}
            >
              <p className="text-[10px] text-zinc-500">
                github.com / {hover.repo?.split("/")[1] ?? "public"}
              </p>
              <p className="mt-0.5 text-sm font-medium text-cyan-300">{hover.title}</p>
            </div>
          )}
        </>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-zinc-500">
          Loading public-safe graph…
        </div>
      )}
    </WorldChrome>
  );
}
