import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { disableResponseCache } from '../scripts/isolated-adapter.mjs';

describe('isolated Cloudflare hosting', () => {
  it('serves dynamic and static requests when the default cache is forbidden', async () => {
    const source = readFileSync(new URL('../../node_modules/@sveltejs/adapter-cloudflare/files/worker.js', import.meta.url), 'utf8');
    const transformed = disableResponseCache(source)
      .replace(/^import .*;$/gm, '')
      .replace(/export \{\s*worker_default as default\s*\};/, 'worker_default;');
    let renders = 0;
    const forbiddenCache = { get default() { throw Error('Default cache forbidden'); } };
    const env = { ASSETS: { fetch: async () => new Response('asset') } };
    const worker = runInNewContext(transformed, { Request, Response, URL, caches: forbiddenCache, env,
      manifest: { appPath: '_app', assets: new Set(['favicon.svg']), _: { server_assets: {} } },
      prerendered: new Set(), base_path: '',
      Server: class { async init() {} async respond() { return new Response(`render-${++renders}`, { headers: { 'Cache-Control': 'public, max-age=60' } }); } }
    });
    const ctx = { waitUntil() {} };
    expect(await (await worker.fetch(new Request('https://example.test/'), env, ctx)).text()).toBe('render-1');
    expect(await (await worker.fetch(new Request('https://example.test/'), env, ctx)).text()).toBe('render-2');
    expect(await (await worker.fetch(new Request('https://example.test/favicon.svg'), env, ctx)).text()).toBe('asset');
  });
  it('requires review if an adapter upgrade changes the patch point', () => {
    expect(() => disableResponseCache('different adapter')).toThrow('implementation changed');
  });
});
