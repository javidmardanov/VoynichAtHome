import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, getSessionFromCtx } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { createLocalAccountIssuer } from 'better-auth/db';
import { z } from 'zod';

export function sitesAuthEnabled(env:Env){
  if(env.SITES_AUTH_ENABLED!=='true'||!env.AUTH_BASE_URL)return false;
  try{const url=new URL(env.AUTH_BASE_URL);return url.protocol==='https:'&&url.hostname.endsWith('.chatgpt.site')&&url.origin===env.AUTH_BASE_URL;}
  catch{return false;}
}

/** The Sites dispatcher authenticates these headers. Never enable on a direct Worker origin. */
export function sitesChatGPT(env:Env):BetterAuthPlugin {
  return {id:'sites-chatgpt',endpoints:{signInSitesChatGPT:createAuthEndpoint('/sign-in/sites-chatgpt',{
    method:'POST',body:z.object({}).strict()
  },async ctx=>{
    const request=ctx.request;
    if(!sitesAuthEnabled(env)||!request||new URL(request.url).origin!==env.AUTH_BASE_URL||request.headers.get('origin')!==env.AUTH_BASE_URL)
      throw new APIError('FORBIDDEN',{message:'ChatGPT sign-in is unavailable for this origin.'});
    const subject=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
    if(!subject||!email)throw new APIError('UNAUTHORIZED',{message:'Open ChatGPT sign-in, then return here to finish signing in.'});
    if(!z.string().min(1).max(200).regex(/^[^\s\x00-\x1f\x7f]+$/u).safeParse(subject).success||!z.email().max(254).safeParse(email).success)
      throw new APIError('UNAUTHORIZED',{message:'The Sites identity is incomplete.'});
    const issuer=createLocalAccountIssuer('sites-chatgpt:'+env.AUTH_BASE_URL),adapter=ctx.context.internalAdapter;
    const key={issuer,accountId:subject};
    let owner=await adapter.findAccountOwnerByKey(key);
    const current=await getSessionFromCtx(ctx,{disableCookieCache:true,disableRefresh:true});
    if(current&&(!owner||owner.kind!=='owned'||owner.user.id!==current.user.id))
      throw new APIError('CONFLICT',{message:'Sign out before switching to another account.'});
    if(!owner){
      const normalizedEmail=email.toLowerCase();
      if(await adapter.findUserByEmail(normalizedEmail)){
        owner=await adapter.findAccountOwnerByKey(key);
        if(!owner||owner.kind!=='owned')throw new APIError('CONFLICT',{message:'An account already uses this email. Sign in with its existing provider.'});
      }
      if(!owner){
        let name='Volunteer';
        if(request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8'){
          try{const supplied=decodeURIComponent(request.headers.get('oai-authenticated-user-full-name')??'').trim().slice(0,80);if(supplied&&supplied.toLowerCase()!==normalizedEmail)name=supplied;}catch{/* Keep a neutral name; contact email must not become a public default. */}
        }
        const userId=crypto.randomUUID(),at=Date.now();
        try{
          // D1 batch is atomic; the configured Better Auth adapter has transaction:false.
          await env.DB.batch([
            env.DB.prepare('INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,0,?,?)').bind(userId,name,normalizedEmail,at,at),
            env.DB.prepare('INSERT INTO account (id,account_id,provider_id,issuer,user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
              .bind(crypto.randomUUID(),subject,'sites-chatgpt',issuer,userId,at,at)
          ]);
        }catch{
          // Only the exact provider subject may win a provisioning race; never adopt an email match.
          owner=await adapter.findAccountOwnerByKey(key);
          if(!owner)throw new APIError('CONFLICT',{message:'Account creation could not finish. Sign in again or use the existing provider.'});
        }
        owner??=await adapter.findAccountOwnerByKey(key);
      }
    }
    if(!owner||owner.kind!=='owned')throw new APIError('CONFLICT',{message:'The account identity is unavailable.'});
    const session=await adapter.createSession(owner.user.id);
    if(!session)throw new APIError('INTERNAL_SERVER_ERROR',{message:'The session could not be created.'});
    await setSessionCookie(ctx,{user:owner.user,session});
    return ctx.json({success:true});
  })}};
}
