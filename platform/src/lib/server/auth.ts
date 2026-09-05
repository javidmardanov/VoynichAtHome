import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../../../db/schema';

export function configuredProviders(env: Env) {
  if(!env.AUTH_BASE_URL||!env.AUTH_SECRET||env.AUTH_SECRET.length<32)return [];
  return [env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? 'github' : null,
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? 'google' : null].filter((v): v is 'github' | 'google' => !!v);
}
export function createAuth(env: Env) {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32 || !env.AUTH_BASE_URL) return null;
  const socialProviders = {
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } } : {}),
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } } : {})
  };
  return betterAuth({
    appName: 'Voynich@home', baseURL: env.AUTH_BASE_URL, secret: env.AUTH_SECRET,
    database: drizzleAdapter(drizzle(env.DB, { schema }), { provider: 'sqlite', schema, transaction: false }),
    socialProviders,
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    emailAndPassword: { enabled: false },
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    user: { deleteUser: { enabled: true } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60 },
    databaseHooks: { user: { delete: { before: async (user) => {
      // Durable tombstones must be applied after restoring any older backup.
      await env.RESEARCH.put('deletions/'+user.id+'.json',JSON.stringify({user_id:user.id,deleted_at:new Date().toISOString()}),{httpMetadata:{contentType:'application/json'}});
      // Delete account identity and proof tokens while retaining anonymous work.
      await env.DB.batch([
        env.DB.prepare('UPDATE profiles SET public = 0 WHERE user_id = ?').bind(user.id),
        env.DB.prepare('UPDATE guests SET user_id = NULL, token_hash = NULL WHERE user_id = ?').bind(user.id),
        env.DB.prepare('UPDATE teams SET moderated = 1 WHERE owner_id = ?').bind(user.id)
      ]);
    } } } }
  });
}
