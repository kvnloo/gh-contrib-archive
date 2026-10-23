/** The API legitimately includes current public attention-only repositories. */
type RepoRow = { repo: string; href: string };
type ArchiveRow = { repo: string };
type RepoIndex = { privacy: string; count: number; repos: RepoRow[] };
type Archive = { privacy: string; repoCount: number; byRepo: ArchiveRow[] };
type Manifest = { privacy: string; counts: { repos: number } };

export function verifyRepoCoverage(api: RepoIndex, archive: Archive, manifest: Manifest) {
  if (api?.privacy !== 'public-safe' || archive?.privacy !== 'public-safe' || manifest?.privacy !== 'public-safe') {
    throw new Error('repo coverage must be checked against public-safe resources');
  }
  if (!Array.isArray(api.repos) || !Number.isSafeInteger(api.count) || api.count !== api.repos.length) {
    throw new Error('API repository index count is inconsistent');
  }
  if (!Array.isArray(archive.byRepo) || !Number.isSafeInteger(archive.repoCount) ||
      !Number.isSafeInteger(manifest.counts?.repos) ||
      archive.byRepo.length !== archive.repoCount || archive.repoCount !== manifest.counts.repos) {
    throw new Error('archive repository count is inconsistent');
  }
  const apiRepos = new Set<string>();
  for (const row of api.repos) {
    if (typeof row.repo !== 'string' || typeof row.href !== 'string' || !row.href.length ||
        apiRepos.has(row.repo)) {
      throw new Error(`invalid or duplicate API repository: ${String(row.repo)}`);
    }
    apiRepos.add(row.repo);
  }
  const archiveRepos = new Set<string>();
  for (const row of archive.byRepo) {
    if (typeof row.repo !== 'string' || archiveRepos.has(row.repo)) {
      throw new Error(`invalid or duplicate archive repository: ${String(row.repo)}`);
    }
    archiveRepos.add(row.repo);
    if (!apiRepos.has(row.repo)) throw new Error(`archive repository missing from API: ${row.repo}`);
  }
  return {
    apiRepos: apiRepos.size,
    archiveRepos: archiveRepos.size,
    attentionOnlyOrEventRepos: apiRepos.size - archiveRepos.size,
  };
}
