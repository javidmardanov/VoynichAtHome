import type { D1Database, R2Bucket, Fetcher, ExecutionContext } from '@cloudflare/workers-types';
declare global {
  namespace App {
    interface Locals { user: { id: string; name: string; email: string } | null; owner: boolean }
    interface Platform { env: Env; context: ExecutionContext; caches: CacheStorage }
  }
  interface Env {
    DB: D1Database; RESEARCH: R2Bucket; ASSETS: Fetcher;
    SEARCH_KERNEL?: WebAssembly.Module;
    AUTH_SECRET?: string; AUTH_BASE_URL?: string;
    GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string;
    GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string;
    OWNER_USER_ID?: string; DEPLOYMENT_STAGE?: string; ASSIGNMENTS_ENABLED?: string;
  }
}
export {};
