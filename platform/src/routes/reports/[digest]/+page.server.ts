import {error} from '@sveltejs/kit';
import type {PageServerLoad} from './$types';
export const load:PageServerLoad=async({params,platform})=>{
  if(!platform?.env.DB)error(503,'Reports are unavailable.');
  if(!/^[0-9a-f]{64}$/.test(params.digest))error(404,'Report not found.');
  const row=await platform.env.DB.prepare('SELECT * FROM reports WHERE digest=?').bind('sha256:'+params.digest)
    .first<{digest:string;campaign_id:string;tier:string;title:string;document:string;withdrawn:number;withdrawal_reason:string|null}>();
  if(!row)error(404,'Report not found.');
  return {row,report:JSON.parse(row.document)};
};
