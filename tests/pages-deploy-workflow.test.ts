import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
const workflow = readFileSync(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
describe('Pages deployment workflow', () => {
  it('tests and builds before uploading only the static publication tree', () => {
    assert.match(workflow, /run: npm test/);
    assert.match(workflow, /run: npm run build/);
    assert.match(workflow, /actions\/configure-pages@v5/);
    assert.match(workflow, /actions\/upload-pages-artifact@v4/);
    assert.match(workflow, /path:\s*\.\/out/);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /NEXT_PUBLIC_BASE_PATH:\s*\/gh-contrib-archive/);
  });
  it('separates deploy authority and verifies the exact published revision', () => {
    assert.match(workflow, /  deploy:[\s\S]*needs: build[\s\S]*pages: write[\s\S]*id-token: write/);
    assert.match(workflow, /actions\/deploy-pages@v4/);
    assert.match(workflow, /  verify-live:[\s\S]*needs: deploy/);
    assert.match(workflow, /\.revision == \$sha/);
    assert.match(workflow, /scripts\/verify-mycelium\.mjs/);
  });
});
