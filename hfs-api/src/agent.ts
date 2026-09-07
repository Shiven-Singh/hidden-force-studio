/**
 * The pipeline. One SequentialAgent, fixed order, with a LoopAgent around the
 * draft and the gate. No stage decides what runs next.
 *
 * This file is where Google Cloud Agent Builder is used: @google/adk is the
 * JavaScript form of google-adk. The README points here.
 */
import { LlmAgent, LoopAgent, SequentialAgent } from '@google/adk';
import type { GenerateContentConfig } from '@google/genai';
import { LockedCharacter, RubricDraft, Screenplay } from '@hfs/schemas';
import { ArtDirectionAgent } from './agents/art-direction.js';
import { GateAgent, MAX_ITERATIONS } from './agents/gate.js';
import { IntakeAgent } from './agents/intake.js';
import { PackageAgent } from './agents/package.js';
import { ResearchAgent, RubricMergeAgent } from './agents/research.js';
import { DRAFT_MODEL, REVIEW_MODEL } from './clients/gemini.js';
import { LOCK_INSTRUCTION, RUBRIC_INSTRUCTION, STORY_INSTRUCTION } from './prompts.js';

/** A hung model call must fail the run, not freeze it. Three minutes is generous for a 3,000-word draft. */
export const MODEL_TIMEOUT_MS = 180_000;
/** Retry rate limits and server errors, which preview models return more often than GA ones. */
export const HTTP_OPTIONS = {
  timeout: MODEL_TIMEOUT_MS,
  retryOptions: { attempts: 3, httpStatusCodes: [408, 429, 500, 502, 503, 504] },
};
const COLD: GenerateContentConfig = { temperature: 0, httpOptions: HTTP_OPTIONS };
const WARM: GenerateContentConfig = { temperature: 0.8, httpOptions: HTTP_OPTIONS };

export const rubricAgent = new LlmAgent({
  name: 'rubric',
  description: 'Compiles a portrayal rubric from the fetched sources.',
  model: REVIEW_MODEL,
  includeContents: 'none',
  instruction: RUBRIC_INSTRUCTION,
  outputSchema: RubricDraft,
  outputKey: 'rubric_draft',
  generateContentConfig: COLD,
});

export const storyAgent = new LlmAgent({
  name: 'story',
  description: 'Drafts the beat sheet and the Fountain screenplay under the rubric.',
  model: DRAFT_MODEL,
  includeContents: 'none',
  instruction: STORY_INSTRUCTION,
  outputSchema: Screenplay,
  outputKey: 'screenplay',
  generateContentConfig: WARM,
});

export const lockAgent = new LlmAgent({
  name: 'lock_character',
  description: 'Writes the locked visual description that every shot prompt repeats verbatim.',
  model: REVIEW_MODEL,
  includeContents: 'none',
  instruction: LOCK_INSTRUCTION,
  outputSchema: LockedCharacter,
  outputKey: 'locked',
  generateContentConfig: COLD,
});

export const draftReviewLoop = new LoopAgent({
  name: 'draft_review_loop',
  description: 'White draft, then up to two revisions. Exits when the gate passes.',
  subAgents: [storyAgent, new GateAgent()],
  maxIterations: MAX_ITERATIONS,
});

export const rootAgent = new SequentialAgent({
  name: 'hidden_force_studio',
  description: 'Bible in, pre-production package out, gate in the middle.',
  subAgents: [
    new IntakeAgent(),
    new ResearchAgent(),
    rubricAgent,
    new RubricMergeAgent(),
    draftReviewLoop,
    lockAgent,
    new ArtDirectionAgent(),
    new PackageAgent(),
  ],
});
