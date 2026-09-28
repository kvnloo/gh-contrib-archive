export const OVERLAP_MS = 2 * 24 * 60 * 60 * 1000;

export function parseArchiveTime(value: string): number {
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) throw new Error(`bad archive timestamp ${value}`);
  return parsed;
}

export function watermarkFrom(maxIso: string | null, now = Date.now(), overlapMs = OVERLAP_MS): string {
  if (!maxIso) {
    throw new Error("public.db has no high-water mark; refusing a full historical ingest");
  }
  const parsed = parseArchiveTime(maxIso);
  if (parsed > now + 24 * 60 * 60 * 1000) {
    throw new Error(`high-water ${maxIso} is in the future`);
  }
  return new Date(parsed - overlapMs).toISOString();
}

export function searchDay(iso: string): string {
  return iso.slice(0, 10);
}

export function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function splitDay(from: string, to: string): string | null {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end - start < 2 * 24 * 60 * 60 * 1000) return null;
  return new Date(start + Math.floor((end - start) / 2 / 86400000) * 86400000).toISOString().slice(0, 10);
}


export function pageIsOlderThan(stamps: (string | null | undefined)[], watermarkIso: string): boolean {
  const watermark = parseArchiveTime(watermarkIso);
  const times = stamps
    .filter((stamp): stamp is string => Boolean(stamp))
    .map((stamp) => parseArchiveTime(stamp));
  if (times.length === 0) return false;
  return Math.max(...times) < watermark;
}
