import Link from "next/link";
import { WORLDS } from "@/components/worlds/WorldChrome";

export default function WorldsHub() {
  return (
    <main className="min-h-screen bg-black px-4 py-16 text-zinc-100">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">choose a world</p>
        <h1 className="mt-2 text-4xl font-semibold">Five graphs of the same life</h1>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          Public GitHub is named. Private work is mass and rhythm only. Keys 1–5 once you are inside.
        </p>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {WORLDS.map((w) => (
            <li key={w.id}>
              <Link
                href={`/worlds/${w.id}`}
                className="block overflow-hidden rounded-2xl ring-1 ring-white/15 hover:ring-white/40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/dream-targets/target-${w.id === "night" ? "night" : w.id}.png`}
                  alt=""
                  className="aspect-video w-full object-cover"
                />
                <div className="p-3 text-sm">
                  <span className="text-zinc-500">{w.keys}</span> {w.title}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
