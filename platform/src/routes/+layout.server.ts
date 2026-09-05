import type { LayoutServerLoad } from './$types';
import { configuredProviders } from '$lib/server/auth';
export const load:LayoutServerLoad=({locals,platform})=>({user:locals.user?{id:locals.user.id,name:locals.user.name}:null,owner:locals.owner,stage:platform?.env.DEPLOYMENT_STAGE??'development',providers:platform?configuredProviders(platform.env):[]});
