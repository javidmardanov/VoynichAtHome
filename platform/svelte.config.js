import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
export default {
  preprocess: vitePreprocess(),
  kit: { adapter: adapter(), csrf: { trustedOrigins: [] },
    csp:{mode:'auto',directives:{'default-src':['self'],'script-src':['self','wasm-unsafe-eval'],'style-src':['self','unsafe-inline'],
      'worker-src':['self'],'connect-src':['self'],'img-src':['self','data:'],'font-src':['self'],'object-src':['none'],'frame-ancestors':['none'],'base-uri':['self'],'form-action':['self']}}
  }
};
