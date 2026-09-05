import type { Handle } from '@sveltejs/kit';
import { createAuth } from '$lib/server/auth';
export const handle: Handle = async ({ event, resolve }) => {
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
