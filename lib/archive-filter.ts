import type { PublicArchiveItem } from "./public-snapshot";

export type ArchiveFilters = {
  type?: string;
  flag?: string;
  repo?: string;
  q?: string;
  year?: string;
};

function isPublic(item: PublicArchiveItem): item is Extract<PublicArchiveItem, { visibility: "public" }> {
  return item.visibility === "public";
}

export function filterArchiveItems(items: PublicArchiveItem[], filters: ArchiveFilters) {
  const repoNeedle = filters.repo?.trim().toLowerCase();
  const queryNeedle = filters.q?.trim().toLowerCase();

  return items.filter((item) => {
    if (filters.type && item.type !== filters.type) return false;
    if (filters.year && item.created_at.slice(0, 4) !== filters.year) return false;

    if (filters.flag) {
      if (!isPublic(item) || !item.flags.some((flag) => flag.code === filters.flag)) return false;
    }

    if (repoNeedle) {
      if (!isPublic(item) || !(item.repo ?? "").toLowerCase().includes(repoNeedle)) return false;
    }

    if (queryNeedle) {
      if (!isPublic(item)) return false;
      const haystack = [
        item.title ?? "",
        item.excerpt ?? "",
        item.url,
        item.repo ?? "",
      ]
        .join("\n")
        .toLowerCase();
      if (!haystack.includes(queryNeedle)) return false;
    }

    return true;
  });
}

export function pageArchiveItems(
  items: PublicArchiveItem[],
  filters: ArchiveFilters,
  requestedPage: number,
  limit: number,
) {
  const filtered = filterArchiveItems(items, filters);
  const safeLimit = Math.max(1, Math.floor(limit) || 1);
  const lastPage = Math.max(0, Math.ceil(filtered.length / safeLimit) - 1);
  const page = Math.min(Math.max(0, Math.floor(requestedPage) || 0), lastPage);
  const offset = page * safeLimit;

  return {
    total: filtered.length,
    page,
    items: filtered.slice(offset, offset + safeLimit),
  };
}
