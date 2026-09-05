import { z } from 'zod';
export const Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const Identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const Budget = z.object({ evaluations: z.number().int().min(1).max(100000), max_input_bytes: z.number().int().min(1).max(8000000), max_memory_bytes: z.number().int().min(1048576).max(100663296) }).strict();
export const Work = z.object({
  version: z.literal('vah-work-1'), type: z.enum(['generation','search','verification']), experiment_digest: Digest,
  input_digest: Digest, algorithm: Identifier, numeric_profile: z.enum(['wasm32-ieee754-libm-scalar-v1','integer-ngram-libm-v1']),
  release_id: Identifier, seed: z.number().int().min(0).max(4294967295), start: z.number().int().min(0).max(4294967295), budget: Budget,
  work_estimate: z.number().int().min(1).max(1000000)
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
export const Campaign = z.object({
  version: z.literal('vah-campaign-1'), id: Identifier, title: z.string().min(5).max(120), question: z.string().min(10).max(500),
  kind: z.enum(['recovery','generator-test','manuscript']), protocol_url: z.string().url(), source_digests: z.array(Digest).min(1),
  methods: z.array(Identifier).min(1), metric: z.string().min(1).max(200), comparisons: z.array(z.string().min(1).max(200)).min(1),
  stopping_rule: z.string().min(10).max(500), exposure: z.string().min(10).max(1000),
  recovery_evidence: z.array(Digest), max_units: z.number().int().min(1).max(100000),
  interpretation: z.string().min(10).max(1000)
}).strict();
export type Campaign = z.infer<typeof Campaign>;

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
