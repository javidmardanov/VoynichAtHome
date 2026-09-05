import { error } from '@sveltejs/kit';import type { PageServerLoad } from './$types';
export const load:PageServerLoad=async({params,platform})=>{
  if(!platform?.env.DB)error(503,'Research records are unavailable.');
  const campaign=await platform.env.DB.prepare("SELECT * FROM campaigns WHERE id=? AND status<>'draft'").bind(params.id).first<{id:string;title:string;question:string;manifest:string;manifest_digest:string;status:string;scientific_status:string}>();
  if(!campaign)error(404,'Campaign not found.');
  const records=await platform.env.DB.prepare('SELECT id,state,trusted_hash FROM units WHERE campaign_id=? ORDER BY id LIMIT 100').bind(params.id).all<{id:string;state:string;trusted_hash:string|null}>();
  const reports=await platform.env.DB.prepare('SELECT digest,title,tier,withdrawn FROM reports WHERE campaign_id=? ORDER BY created_at DESC').bind(campaign.id).all<{digest:string;title:string;tier:string;withdrawn:number}>();
  return {campaign,manifest:JSON.parse(campaign.manifest),records:records.results,reports:reports.results};
};
