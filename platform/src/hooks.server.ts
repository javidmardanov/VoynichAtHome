import type { Handle } from '@sveltejs/kit';
import { createAuth } from '$lib/server/auth';
import { withMaintenanceRun,ownerInvocation } from '$lib/server/maintenance-guard';
import { ApiError } from '$lib/server/coordinator';
export const handle: Handle = async (input) => {
  const {event}=input,env=event.platform?.env;
  // The signed scheduler authenticates before claiming its own durable invocation.
  if(event.url.pathname==='/api/maintenance/github')return input.resolve(event);
  if(!env?.DB)return handleRequest(input);
  const exclusive=event.request.method==='POST'&&['/api/v1/owner','/api/v1/owner/validate'].includes(event.url.pathname);
  try{
    if(exclusive){
      if(!env.OWNER_USER_ID||!event.request.headers.has('cookie')||event.request.headers.get('origin')!==event.url.origin)
        throw new ApiError(403,'Owner access required.');
      // Unauthenticated callers must not exclude all ordinary requests. Authentication
      // is repeated under the exclusive guard after this shared preflight is released.
      await withMaintenanceRun(env,ownerInvocation('owner-preflight'),async scoped=>{
        const session=await createAuth(scoped)?.api.getSession({headers:event.request.headers,query:{disableCookieCache:true,disableRefresh:true}});
        if(!session||session.user.id!==env.OWNER_USER_ID)throw new ApiError(403,'Owner access required.');
      },'shared');
    }
    return await withMaintenanceRun(env,ownerInvocation('http-request'),async scoped=>{
    event.platform={...event.platform!,env:scoped};
    return handleRequest(input);
    },exclusive?'exclusive':'shared');
  }
  catch(error){
    if(!(error instanceof ApiError))throw error;
    return new Response(JSON.stringify({error:error.message}),{status:error.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Retry-After':'5'}});
  }
};
const handleRequest: Handle = async ({ event, resolve }) => {
  event.locals.user = null; event.locals.owner = false;
  const env = event.platform?.env;
  const auth = env ? createAuth(env) : null;
  const refreshedCookies:string[]=[];
  if (event.url.pathname.startsWith('/api/auth/')) {
    if (!auth) return new Response(JSON.stringify({ error: 'Sign-in is not configured for this deployment.' }), { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    const response=await auth.handler(event.request);
    response.headers.set('Cache-Control','no-store');
    response.headers.set('X-Content-Type-Options','nosniff');
    response.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
    return response;
  }
  if (auth && event.request.headers.has('cookie')) {
    const result = await auth.api.getSession({ headers: event.request.headers, returnHeaders:true });
    const session=result.response;
    refreshedCookies.push(...result.headers.getSetCookie());
    if (session) { event.locals.user = { id: session.user.id, name: session.user.name, email: session.user.email }; event.locals.owner = session.user.id === env?.OWNER_USER_ID; }
  }
  const response = await resolve(event);
  for(const cookie of refreshedCookies)response.headers.append('Set-Cookie',cookie);
  response.headers.set('X-Content-Type-Options','nosniff');
  response.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if (event.locals.user || event.url.pathname.startsWith('/api/')) response.headers.set('Cache-Control','no-store');
  return response;
};
