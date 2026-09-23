export const WORLD_NAV_IDS = [
  "mycelium",
  "night",
  "phase",
  "metro",
  "constellation",
] as const;

export type WorldNavId = (typeof WORLD_NAV_IDS)[number];

function currentIndex(currentId: string) {
  const index = WORLD_NAV_IDS.indexOf(currentId as WorldNavId);
  return index >= 0 ? index : 0;
}

export function adjacentWorldId(currentId: string, direction: -1 | 1): WorldNavId {
  const index = currentIndex(currentId);
  return WORLD_NAV_IDS[
    (index + direction + WORLD_NAV_IDS.length) % WORLD_NAV_IDS.length
  ];
}

export function worldIdForSwipe(
  currentId: string,
  deltaX: number,
  threshold = 48,
): WorldNavId {
  if (Math.abs(deltaX) < threshold) {
    return WORLD_NAV_IDS[currentIndex(currentId)];
  }
  return adjacentWorldId(currentId, deltaX < 0 ? 1 : -1);
}
