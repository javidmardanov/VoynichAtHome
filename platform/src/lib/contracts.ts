import { z } from 'zod';
export const Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const Identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const Budget = z.object({ evaluations: z.number().int().min(1).max(100000), max_input_bytes: z.number().int().min(1).max(8000000), max_memory_bytes: z.number().int().min(1048576).max(100663296) }).strict();
export const Work = z.object({
  version: z.literal('vah-work-1'), type: z.enum(['generation','search','verification']), experiment_digest: Digest,
  input_digest: Digest, algorithm: Identifier, numeric_profile: z.enum(['wasm32-ieee754-libm-scalar-v1','integer-ngram-libm-v1']),
  release_id: Identifier, seed: z.number().int().min(0).max(4294967295), start: z.number().int().min(0).max(4294967295), budget: Budget,
  work_estimate: z.number().int().min(1).max(2000000)
}).strict();
export type Work = z.infer<typeof Work>;
export const SearchJob = z.object({
  version: z.literal('vah-search-1'), experiment: z.string().min(1).max(160),
  ciphertext: z.array(z.number().int().min(0).max(91)).min(4).max(20000), symbol_count: z.number().int().min(2).max(92),
  encoding: z.enum(['substitution','homophonic','balanced-homophonic']), algorithm: z.enum(['beam-v1','restart-anneal-v1']),
  seed: z.number().int().min(0).max(4294967295), start: z.number().int().min(0).max(4294967295),
  iterations: z.number().int().min(1).max(100000), beam_width: z.number().int().min(1).max(64),
  model: z.object({ version: z.literal('vah-ngram-1'), alphabet: z.literal('abcdefghilmnopqrstuvxyz'),
    training_sources: z.array(Digest).min(1).max(100), quadgrams: z.array(z.number().int().min(-1000000).max(0)).length(279841),
    unigrams: z.array(z.number().int().min(-1000000).max(0)).length(23) }).strict()
}).strict().superRefine((job,ctx) => {
  if (job.ciphertext.some(c=>c>=job.symbol_count) || (job.encoding==='substitution' && job.symbol_count!==23)
    || (job.encoding==='balanced-homophonic' && job.symbol_count%23!==0)) ctx.addIssue({code:'custom',message:'Encoding and symbol domain disagree.'});
});
export type SearchJob = z.infer<typeof SearchJob>;
export const SearchResult = z.object({version:z.literal('vah-search-result-1'),job_digest:Digest,algorithm:z.enum(['beam-v1','restart-anneal-v1']),
  key:z.array(z.number().int().min(0).max(22)).min(2).max(92),plaintext:z.string().min(4).max(20000).regex(/^[abcdefghilmnopqrstuvxyz]+$/),
  score:z.number().int().min(-20000000000).max(0),evaluations:z.number().int().min(0).max(100000),trace:z.array(Digest).max(1000),result_digest:Digest}).strict();
export type SearchResult=z.infer<typeof SearchResult>;
export const Release = z.object({id:Identifier,digest:Digest,url:z.string().regex(/^\/kernels\/[0-9a-f]{64}\.wasm$/)}).strict();
export const Lease = z.object({state:z.literal('work'),version:z.literal('vah-lease-1'),attempt_id:Identifier,unit_id:Digest,expires_at:z.number().int().nonnegative(),work:Work,
  input_url:z.string().regex(/^\/api\/v1\/work\/[a-zA-Z0-9_-]+$/),release:Release}).strict();
export const Reproduction = z.object({version:z.literal('vah-reproduction-1'),unit_id:Digest,work:Work,job:SearchJob,result:SearchResult.nullable(),result_hash:Digest.nullable(),
  state:z.enum(['importing','open','checking','validation_error','delivery_exhausted','complete']),release:Release.extend({state:z.enum(['approved','revoked'])})}).strict();
export const PublicName=z.string().trim().min(2).max(48).regex(/^[\p{L}\p{N} ._'’-]+$/u,'Use letters, numbers, spaces, or simple punctuation.');
export const ProfileUpdate=z.object({display_name:PublicName,public:z.boolean()}).strict();
export const TeamUpdate=z.union([z.object({create:PublicName}).strict(),z.object({join:z.string().uuid()}).strict(),z.object({leave:z.literal(true)}).strict()]);
export function validateSearchWork(work: Work, input: unknown) {
  const job=SearchJob.parse(input);
  if (work.type!=='search' || work.numeric_profile!=='integer-ngram-libm-v1' || work.algorithm!==job.algorithm
    || work.seed!==job.seed || work.start!==job.start || work.budget.evaluations!==job.iterations
    || work.experiment_digest!==job.experiment || work.budget.max_memory_bytes!==100663296)
    throw new Error('Scientific work and search input disagree or use an unsupported execution path.');
  // Fixed published estimate: normalized symbols evaluated, rounded up in blocks of 1000.
  if (work.work_estimate!==Math.ceil(job.iterations*job.ciphertext.length/1000)) throw new Error('Work estimate does not match the published formula.');
  return job;
}
export const Submission = z.object({ version: z.literal('vah-submission-1'), attempt_id: Identifier, unit_id: Digest, result: z.record(z.string(),z.unknown()) }).strict();
export const RecoveryCondition=z.object({encoding:z.enum(['substitution','balanced-homophonic','naibbe-global-permutation']),language:z.enum(['latin','italian']),
  length:z.union([z.literal(1000),z.literal(5000),z.literal(20000)]),starts:z.union([z.literal(1),z.literal(8),z.literal(64)]),iterations:z.number().int().min(1).max(100000),
  algorithm:z.enum(['beam-v1','restart-anneal-v1']),beam_width:z.number().int().min(1).max(64),model_digest:Digest}).strict();
export const Campaign = z.object({
  version: z.literal('vah-campaign-1'), id: Identifier, title: z.string().min(5).max(120), question: z.string().min(10).max(500),
  kind: z.enum(['recovery','generator-test','manuscript']), protocol_url: z.string().url(), source_digests: z.array(Digest).min(1),
  methods: z.array(Identifier).min(1), metric: z.string().min(1).max(200), comparisons: z.array(z.string().min(1).max(200)).min(1),
  stopping_rule: z.string().min(10).max(500), exposure: z.string().min(10).max(1000),
  recovery_evidence: z.array(Digest), max_units: z.number().int().min(1).max(100000),
  interpretation: z.string().min(10).max(1000),
  search_condition:RecoveryCondition.optional(),
  manuscript_layout:z.object({transcription_digest:Digest,ciphertext_digest:Digest,symbol_grouping:z.string().min(10).max(1000),space_handling:z.string().min(5).max(1000),
    lines:z.array(z.object({folio:z.string().min(1).max(30),paragraph:z.string().min(1).max(50),line:z.string().min(1).max(50),offset:z.number().int().min(0).max(19999),length:z.number().int().min(1).max(20000),uncertain_positions:z.array(z.number().int().min(0).max(19999))}).strict()).min(1).max(2000),
    excluded_material:z.array(z.string().min(1).max(1000)).max(1000)}).strict().optional()
}).strict();
export type Campaign = z.infer<typeof Campaign>;
const EvidenceURL=z.string().url().startsWith('https://').max(1000);
export const ScientificReport=z.object({
  version:z.literal('vah-scientific-report-1'),campaign_digest:Digest,title:z.string().min(5).max(120),
  tier:z.enum(['computation','candidate','conclusion']),summary:z.string().min(30).max(3000),
  limitations:z.array(z.string().min(10).max(1000)).min(1).max(20),evidence_url:EvidenceURL,
  record_ids:z.array(Digest).min(1).max(20),comparison_assessment:z.string().min(30).max(3000),
  reviews:z.array(z.object({name:z.string().min(2).max(100),role:z.enum(['owner','external-reproduction','specialist']),record_url:EvidenceURL}).strict()).max(20),
  recovery_scope:z.array(RecoveryCondition.extend({
    cases:z.literal(100),exact_recoveries:z.number().int().min(1).max(100),evaluation_digest:Digest,freeze_url:EvidenceURL,
    usefulness_rationale:z.string().min(40).max(2000)}).strict()).max(100),
  owner_attests_evidence_reviewed:z.literal(true)
}).strict().superRefine((report,ctx)=>{
  if(new Set(report.record_ids).size!==report.record_ids.length)ctx.addIssue({code:'custom',message:'Duplicate report records.'});
  if(report.tier!=='computation'&&(!report.reviews.some(r=>r.role==='external-reproduction')||!report.reviews.some(r=>r.role==='specialist')))
    ctx.addIssue({code:'custom',message:'Promotion requires linked external reproduction and specialist review records.'});
});
export type ScientificReport=z.infer<typeof ScientificReport>;

export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('Nonfinite number'); return JSON.stringify(value); }
  if (typeof value === 'string') { if (!value.isWellFormed()) throw new Error('Invalid Unicode'); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => canonical(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',') + '}';
  throw new Error('Value is outside JSON');
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return 'sha256:' + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,'0')).join('');
}
export function identity(value: unknown): Promise<string> { return sha256(new TextEncoder().encode(canonical(value))); }
