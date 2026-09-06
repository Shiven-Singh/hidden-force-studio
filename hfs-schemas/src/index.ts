import { z } from 'zod';

export const CharacterBible = z.object({
  name: z.string(),
  pronunciation: z.string(),
  age: z.number().int().min(6).max(12),
  trait: z.string(),
  trait_clinical_name: z.string(),
  reframe: z.string(),
  physical_description: z.string(),
  strengths: z.array(z.string()).min(2),
  vulnerabilities: z.array(z.string()).min(1),
  fear_carried_in: z.string(),
  story_premise: z.string(),
  colour_palette: z.array(z.string()),
  totem: z.string(),
  /** Set on the demo bible written to fail HF1. Shown in the UI and declared on camera. */
  adversarial: z.boolean().optional(),
});

export const Source = z.object({
  idx: z.number().int(),
  title: z.string(),
  url: z.string(),
  publisher: z.string(),
  publish_date: z.string().nullable(),
  retrieved: z.string(),
  excerpt: z.string(),
  pool: z.enum(['advocacy', 'general']),
});

export const Rule = z.object({
  id: z.string(),
  rule: z.string(),
  source_ref: z.number().int(),
});

export const PortrayalRubric = z.object({
  trait: z.string(),
  generated_at: z.string(),
  sources: z.array(Source),
  must_do: z.array(Rule).min(2),
  must_not_do: z.array(Rule).min(2),
  preferred_terms: z.array(z.string()),
  avoid_terms: z.array(z.string()),
});

/**
 * What the rubric LlmAgent is asked to produce. Sources and the timestamp are
 * merged in by code afterwards so the model never gets to rewrite a citation.
 */
export const RubricDraft = PortrayalRubric.omit({ sources: true, generated_at: true, trait: true });

export const Beat = z.object({
  number: z.number().int(),
  title: z.string(),
  summary: z.string(),
  trait_in_play: z.string(),
});

export const Screenplay = z.object({
  title: z.string(),
  logline: z.string(),
  beats: z.array(Beat).min(10).max(15),
  fountain: z.string(),
  page_estimate: z.number().int(),
  trait_causality_note: z.string(),
});

export const RuleScore = z.object({
  rule_id: z.string(),
  result: z.enum(['pass', 'fail', 'unclear']),
  evidence: z.string(),
  note: z.string().default(''),
});

export const ReviewReport = z.object({
  verdict: z.enum(['PASS', 'REVISE', 'HALT']),
  iteration: z.number().int(),
  revision_colour: z.enum(['White', 'Blue', 'Pink']),
  deterministic: z.array(RuleScore),
  model_scored: z.array(RuleScore),
  hard_failures: z.array(z.string()),
  soft_notes: z.array(z.string()),
  revision_instructions: z.array(z.string()),
  evidence_unverified: z.array(z.string()),
});

export const LockedCharacter = z.object({
  locked_description: z.string(),
  turnarounds: z.array(z.string()),
  expressions: z.array(z.string()),
  negative_prompts: z.array(z.string()),
});

export const Shot = z.object({
  number: z.number().int(),
  beat: z.number().int(),
  scene_heading: z.string(),
  prompt: z.string(),
  camera: z.string(),
  palette: z.array(z.string()),
});

export const ArtBrief = z.object({
  character: LockedCharacter,
  consistency_hash: z.string(),
  shots: z.array(Shot).min(12),
});

export const RunManifest = z.object({
  run_id: z.string(),
  character: z.string(),
  started_at: z.string(),
  finished_at: z.string(),
  verdict: z.string(),
  iterations: z.number().int(),
  models: z.record(z.string(), z.string()),
  adk_version: z.string(),
  parallel_search_ids: z.array(z.string()),
  source_urls: z.array(z.string()),
  stage_timings_ms: z.record(z.string(), z.number()),
});

export type CharacterBible = z.infer<typeof CharacterBible>;
export type Source = z.infer<typeof Source>;
export type Rule = z.infer<typeof Rule>;
export type PortrayalRubric = z.infer<typeof PortrayalRubric>;
export type Beat = z.infer<typeof Beat>;
export type Screenplay = z.infer<typeof Screenplay>;
export type RuleScore = z.infer<typeof RuleScore>;
export type ReviewReport = z.infer<typeof ReviewReport>;
export type LockedCharacter = z.infer<typeof LockedCharacter>;
export type Shot = z.infer<typeof Shot>;
export type ArtBrief = z.infer<typeof ArtBrief>;
export type RunManifest = z.infer<typeof RunManifest>;

/** Stage names in execution order. The UI timeline and the run manifest both key on these. */
export const STAGES = [
  'intake', 'research', 'rubric', 'story', 'gate', 'lock_character', 'art_direction', 'package',
] as const;
export type Stage = (typeof STAGES)[number];
