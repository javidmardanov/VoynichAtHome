import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
export const load:PageServerLoad=({locals})=>{if(!locals.owner)error(403,'Owner access required.');return {};};
