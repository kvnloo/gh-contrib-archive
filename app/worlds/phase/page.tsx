"use client";

import PhaseScene from "@/components/worlds/phase/Scene";
import { WorldChrome } from "@/components/worlds/WorldChrome";

export default function Page() {
  return (
    <WorldChrome title="Phase">
      <PhaseScene />
    </WorldChrome>
  );
}
