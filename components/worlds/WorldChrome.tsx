"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { WORLDS } from "@/components/worlds/catalog";

export function WorldChrome({ children, title }: { children: React.ReactNode; title: string }) {
  const path = usePathname();
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const w = WORLDS.find((x) => x.keys === e.key);
      if (w) router.push(`/worlds/${w.id}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
  return (
    <div className="fixed inset-0 z-10 overflow-hidden bg-black text-zinc-100">
      {children}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/70 to-transparent p-4">
        <div className="pointer-events-auto flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">kvnloo worlds</p>
            <h1 className="text-lg font-medium">{title}</h1>
          </div>
          <nav className="flex flex-wrap gap-1">
            {WORLDS.map((w) => {
              const href = `/worlds/${w.id}`;
              const on = path === href;
              return (
                <Link
                  key={w.id}
                  href={href}
                  className={`rounded-full px-3 py-1 text-xs ring-1 ${
                    on ? "bg-white text-black ring-white" : "bg-black/40 text-zinc-200 ring-white/20 hover:bg-white/10"
                  }`}
                >
                  {w.keys} {w.title}
                </Link>
              );
            })}
            <Link href="/" className="rounded-full px-3 py-1 text-xs text-zinc-400 ring-1 ring-white/10">
              ledger
            </Link>
          </nav>
        </div>
      </div>
    </div>
  );
}
