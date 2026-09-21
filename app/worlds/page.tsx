import Link from "next/link";
import { WORLDS } from "@/components/worlds/catalog";
import { publicAssetPath } from "@/lib/public-path";

export default function WorldsHub() {
  return (
    <main className="min-h-screen bg-black px-4 py-8 text-zinc-100 sm:py-16">
      <div className="mx-auto max-w-5xl">
        <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 sm:text-xs">choose a world</p>
        <h1 className="mt-2 max-w-3xl text-3xl font-semibold leading-tight sm:text-4xl">
          Five graphs of the same life
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
          Public GitHub is named. Private work is mass and rhythm only. Tap a world below; keys 1–5 still work on desktop.
        </p>

        <ul className="-mx-4 mt-7 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:mt-10 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-3">
          {WORLDS.map((world) => (
            <li key={world.id} className="min-w-[82vw] snap-center sm:min-w-0">
              <Link
                href={`/worlds/${world.id}`}
                className="group block min-h-11 overflow-hidden rounded-2xl bg-zinc-950 ring-1 ring-white/15 transition hover:ring-white/40 active:scale-[0.99]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={publicAssetPath(`/dream-targets/target-${world.id === "night" ? "night" : world.id}.png`)}
                  alt=""
                  className="aspect-video w-full object-cover"
                />
                <div className="flex min-h-12 items-center justify-between gap-3 p-3 text-sm">
                  <span className="font-medium">{world.title}</span>
                  <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] text-zinc-500 ring-1 ring-white/10">
                    {world.keys}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-center text-[10px] uppercase tracking-[0.2em] text-zinc-600 sm:hidden">
          swipe cards · tap to enter
        </p>
      </div>
    </main>
  );
}
