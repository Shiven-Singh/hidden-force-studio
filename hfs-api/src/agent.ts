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
import { StoryboardAgent } from './agents/storyboard.js';
import { TimedGemini } from './clients/adk-model.js';
import { DRAFT_MODEL, REVIEW_MODEL } from './clients/gemini.js';
import { LOCK_INSTRUCTION, RUBRIC_INSTRUCTION, STORY_INSTRUCTION } from './prompts.js';

const COLD: GenerateContentConfig = { temperature: 0 };
const WARM: GenerateContentConfig = { temperature: 0.8 };

/** Model instances carry the timeout and retry policy; see clients/adk-model.ts. */
const reviewModel = new TimedGemini(REVIEW_MODEL);
const draftModel = new TimedGemini(DRAFT_MODEL);

export const rubricAgent = new LlmAgent({
  name: 'rubric',
  description: 'Compiles a portrayal rubric from the fetched sources.',
  model: reviewModel,
  includeContents: 'none',
  instruction: RUBRIC_INSTRUCTION,
  outputSchema: RubricDraft,
  outputKey: 'rubric_draft',
  generateContentConfig: COLD,
});

export const storyAgent = new LlmAgent({
  name: 'story',
  description: 'Drafts the beat sheet and the Fountain screenplay under the rubric.',
  model: draftModel,
  includeContents: 'none',
  instruction: STORY_INSTRUCTION,
  outputSchema: Screenplay,
  outputKey: 'screenplay',
  generateContentConfig: WARM,
});

export const lockAgent = new LlmAgent({
  name: 'lock_character',
  description: 'Writes the locked visual description that every shot prompt repeats verbatim.',
  model: reviewModel,
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
    new StoryboardAgent(),
    new PackageAgent(),
  ],
});
