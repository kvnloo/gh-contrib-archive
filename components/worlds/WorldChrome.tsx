"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { WORLDS } from "@/components/worlds/catalog";
import { isSceneCaptureMode } from "@/lib/visual-capture";
import {
  adjacentWorldId,
  worldIdForSwipe,
} from "@/components/worlds/navigation";

export function WorldChrome({ children, title }: { children: React.ReactNode; title: string }) {
  const path = usePathname();
  const router = useRouter();
  const touchStartX = useRef<number | null>(null);
  const [captureMode, setCaptureMode] = useState(false);
  const currentWorld = WORLDS.find((world) => path.endsWith(`/${world.id}`)) ?? WORLDS[0];

  useEffect(() => {
    setCaptureMode(isSceneCaptureMode(window.location.search));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const world = WORLDS.find((item) => item.keys === event.key);
      if (world) router.push(`/worlds/${world.id}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const move = (direction: -1 | 1) => {
    router.push(`/worlds/${adjacentWorldId(currentWorld.id, direction)}`);
  };

  return (
    <div className="fixed inset-0 z-10 overflow-hidden bg-black text-zinc-100">
      {children}

      {!captureMode ? <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/80 via-black/45 to-transparent px-3 pb-8 pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:p-4 sm:pb-10">
        <div className="pointer-events-auto flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-[0.28em] text-zinc-500 sm:text-[10px]">
              kvnloo worlds
            </p>
            <h1 className="truncate text-base font-medium sm:text-lg">{title}</h1>
          </div>

          <nav className="hidden flex-wrap justify-end gap-1 sm:flex">
            {WORLDS.map((world) => {
              const href = `/worlds/${world.id}`;
              const active = currentWorld.id === world.id;
              return (
                <Link
                  key={world.id}
                  href={href}
                  className={`min-h-9 rounded-full px-3 py-2 text-xs ring-1 ${
                    active
                      ? "bg-white text-black ring-white"
                      : "bg-black/40 text-zinc-200 ring-white/20 hover:bg-white/10"
                  }`}
                >
                  {world.keys} {world.title}
                </Link>
              );
            })}
            <Link
              href="/"
              className="min-h-9 rounded-full px-3 py-2 text-xs text-zinc-400 ring-1 ring-white/10 hover:bg-white/10"
            >
              ledger
            </Link>
          </nav>

          <Link
            href="/"
            className="flex min-h-11 shrink-0 items-center rounded-full bg-black/50 px-3 text-xs text-zinc-300 ring-1 ring-white/15 backdrop-blur sm:hidden"
          >
            ledger
          </Link>
        </div>
      </div> : null}

      {!captureMode ? <nav
        aria-label="Mobile world navigation"
        className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 border-t border-white/10 bg-black/70 px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-xl sm:hidden"
        onTouchStart={(event) => {
          touchStartX.current = event.changedTouches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          const start = touchStartX.current;
          touchStartX.current = null;
          if (start == null) return;
          const end = event.changedTouches[0]?.clientX ?? start;
          const next = worldIdForSwipe(currentWorld.id, end - start);
          if (next !== currentWorld.id) router.push(`/worlds/${next}`);
        }}
      >
        <button
          type="button"
          onClick={() => move(-1)}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/5 text-xl text-zinc-200 ring-1 ring-white/15 active:bg-white/15"
          aria-label="Previous world"
        >
          ‹
        </button>

        <Link
          href="/worlds"
          className="flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-full bg-white/10 px-3 text-sm font-medium ring-1 ring-white/15 active:bg-white/15"
        >
          <span className="text-xs text-zinc-500">{currentWorld.keys}</span>
          <span className="truncate">{currentWorld.title}</span>
          <span className="text-[10px] uppercase tracking-widest text-zinc-500">all</span>
        </Link>

        <button
          type="button"
          onClick={() => move(1)}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/5 text-xl text-zinc-200 ring-1 ring-white/15 active:bg-white/15"
          aria-label="Next world"
        >
          ›
        </button>
      </nav> : null}
    </div>
  );
}
