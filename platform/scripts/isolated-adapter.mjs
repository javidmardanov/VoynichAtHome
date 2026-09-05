import cloudflare from '@sveltejs/adapter-cloudflare';
import { readFile, writeFile } from 'node:fs/promises';

// Workers for Platforms forbids caches.default. The upstream adapter has no
// cache option. Keep its routing/asset implementation and disable only its
// optional response cache. ASSETS still owns immutable-file caching.
// This guarded transformation intentionally fails when the pinned adapter's
// implementation changes, so dependency upgrades cannot silently reintroduce it.
export function disableResponseCache(source) {
  const marker = 'var s = caches.default;';
  if (source.split(marker).length !== 2) throw Error('Cloudflare adapter cache implementation changed; review isolated hosting compatibility.');
  return source.replace(marker, 'var s = { async match() { return undefined; }, async put() {} };');
}

export default function isolatedAdapter() {
  const upstream = cloudflare();
  return { ...upstream, name: 'voynich-isolated-cloudflare', async adapt(builder) {
    await upstream.adapt(builder);
    const entry = `${builder.getBuildDirectory('cloudflare')}/_worker.js`;
    await writeFile(entry, disableResponseCache(await readFile(entry, 'utf8')));
  } };
}
