import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { verifyRepoCoverage } from '../scripts/verify-repo-coverage.ts';

const archive = { privacy: 'public-safe', repoCount: 2, byRepo: [{ repo: 'a/one', n: 1 }, { repo: 'b/two', n: 1 }] };
const manifest = { privacy: 'public-safe', counts: { repos: 2 } };
const api = { privacy: 'public-safe', count: 3, repos: [
  { repo: 'a/one', href: 'repos/a/one.json' },
  { repo: 'b/two', href: 'repos/b/two.json' },
  { repo: 'c/three', href: 'repos/c/three.json' },
] };

describe('repo coverage includes current public attention-only repos', () => {
  it('accepts a superset of the archive, not count equality', () => {
    assert.deepEqual(verifyRepoCoverage(api, archive, manifest), {
      apiRepos: 3, archiveRepos: 2, attentionOnlyOrEventRepos: 1,
    });
  });
  it('rejects absent archive repos even if counts are high enough', () => {
    const missing = { ...api, repos: [
      ...api.repos.filter(row => row.repo !== 'b/two'),
      { repo: 'd/four', href: 'repos/d/four.json' },
    ] };
    assert.throws(() => verifyRepoCoverage(missing, archive, manifest), /archive repository missing/);
  });
  it('rejects duplicate API repositories', () => {
    assert.throws(() => verifyRepoCoverage({
      ...api, repos: [api.repos[0], api.repos[0], api.repos[1]],
    }, archive, manifest), /duplicate API/);
  });
  it('rejects inconsistent archive manifest', () => {
    assert.throws(() => verifyRepoCoverage(api, archive, {
      ...manifest, counts: { repos: 5 },
    }), /archive repository count/);
  });
  it('rejects private/unknown resources', () => {
    assert.throws(() => verifyRepoCoverage({ ...api, privacy: 'private' }, archive, manifest), /public-safe/);
  });
});
