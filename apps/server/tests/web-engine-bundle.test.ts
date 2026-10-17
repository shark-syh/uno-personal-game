import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildWebEngine, WEB_ENGINE_OUTFILE } from '../../../scripts/web-engine-build.ts';

const tempDir = mkdtempSync(join(tmpdir(), 'uno-bundle-'));
afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('M3-2 浏览器引擎 bundle', () => {
  it('仓库内 apps/web/js/vendor/uno-engine.js 与 TS 源码同步', async () => {
    const freshFile = join(tempDir, 'uno-engine.js');
    await buildWebEngine({ outfile: freshFile });
    const fresh = readFileSync(freshFile);
    const committed = readFileSync(WEB_ENGINE_OUTFILE);
    expect(fresh.equals(committed)).toBe(true);
  }, 30_000);
});
