const T0 = Date.parse("2012-01-01T00:00:00Z");
const T1 = Date.parse("2027-01-01T00:00:00Z");

export function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function isoToYear(iso: string): number {
  return new Date(iso).getFullYear();
}

export function isoToLon(iso: string): number {
  const t = Date.parse(iso);
  const u = Math.min(1, Math.max(0, (t - T0) / (T1 - T0)));
  return -Math.PI * 0.72 + u * Math.PI * 1.44;
}

export function monthToLon(month: string): number {
  const [y, m] = month.split("-").map(Number);
  const t = Date.UTC(y, (m ?? 1) - 1, 15);
  const u = Math.min(1, Math.max(0, (t - T0) / (T1 - T0)));
  return -Math.PI * 0.72 + u * Math.PI * 1.44;
}

export function latForSeed(seed: string, year: number): number {
  const u = hash01(seed);
  const v = hash01(`${seed}:v`);
  if (year >= 2025) {
    const center = 0.52 + v * 0.12;
    return center + (u - 0.5) * 0.22;
  }
  if (year >= 2020) {
    return (u - 0.5) * 1.1;
  }
  return (u - 0.5) * 1.65;
}

export function latLonToVec3(lat: number, lon: number, r: number): [number, number, number] {
  const cl = Math.cos(lat);
  return [r * cl * Math.cos(lon), r * Math.sin(lat), r * cl * Math.sin(lon)];
}

export const TYPE_COLORS: Record<string, string> = {
  pull_request: "#5eead4",
  issue: "#fbbf24",
  comment: "#f59e0b",
  discussion: "#a78bfa",
  discussion_comment: "#c084fc",
  review_comment: "#fb923c",
  review: "#f97316",
};

export const PRIVATE_GLOW = "#3d2a18";
export const LIGHT_PUBLIC = "#c9a227";
export const LIGHT_PRIVATE = "#2a1f14";
