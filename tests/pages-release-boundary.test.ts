import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
const deploy = readFileSync(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
const promotion = readFileSync(new URL('../.github/workflows/automerge-nightly.yml', import.meta.url), 'utf8');
describe('Pages release boundary', () => {
  it('publishes only an immutable main commit in main event context', () => {
    assert.match(deploy, /branches:\s*\[main\]/);
    assert.match(deploy, /github\.ref == 'refs\/heads\/main'/);
    assert.match(deploy, /ref:\s*\$\{\{ github\.sha \}\}/);
    assert.doesNotMatch(deploy, /workflow_call:|inputs\.ref/);
    assert.match(deploy, /name:\s*github-pages/);
    assert.match(deploy, /path:\s*\.\/out/);
    assert.match(deploy, /release\.json/);
  });
  it('does not publish from pull-request promotion context or grant it Pages authority', () => {
    assert.doesNotMatch(promotion, /deploy-pages\.yml|pages:\s*write|id-token:\s*write/);
  });
});
