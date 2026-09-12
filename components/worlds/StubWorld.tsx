"use client";

import { WorldChrome } from "@/components/worlds/WorldChrome";
import { useWorldGraph } from "@/components/worlds/useWorldGraph";

export default function StubWorld({
  title,
  hint,
}: {
  title: string;
  hint: string;
}) {
  const g = useWorldGraph();
  return (
    <WorldChrome title={title}>
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        {g ? hint : "Loading public-safe graph…"}
      </div>
    </WorldChrome>
  );
}
