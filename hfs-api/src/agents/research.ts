import { createEvent, type InvocationContext, type Event } from '@google/adk';
import { PipelineAgent } from './base.js';
import { CharacterBible, PortrayalRubric, RubricDraft, type Source } from '@hfs/schemas';
import { fetchGuidance } from '../clients/parallel.js';

const timings = (ctx: InvocationContext): Record<string, number> =>
  ({ ...((ctx.session.state['stage_timings_ms'] as Record<string, number> | undefined) ?? {}) });

/** Stage 2a. Calls Parallel and stores the labelled sources verbatim. */
export class ResearchAgent extends PipelineAgent {
  constructor() {
    super({ name: 'research', description: 'Fetches live portrayal guidance for the trait via Parallel Search.' });
  }

  protected async *runAsyncImpl(ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    const started = Date.now();
    const bible = CharacterBible.parse(ctx.session.state['bible']);
    const { searchIds, sources } = await fetchGuidance(bible);
    const delta: Record<string, unknown> = {
      sources,
      parallel_search_ids: searchIds,
      stage_timings_ms: { ...timings(ctx), research: Date.now() - started },
    };
    Object.assign(ctx.session.state, delta);
    yield createEvent({ author: this.name, actions: { stateDelta: delta } });
  }
}

/**
 * Stage 2b. The rubric LlmAgent writes `rubric_draft`. This merges the sources
 * back in by code, so no citation URL ever passes through the model.
 */
export class RubricMergeAgent extends PipelineAgent {
  constructor() {
    super({ name: 'rubric_merge', description: 'Attaches verbatim sources to the model-drafted rubric.' });
  }

  protected async *runAsyncImpl(ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    const draft = this.read(ctx, 'rubric_draft', RubricDraft, 'rubric');
    const bible = this.read(ctx, 'bible', CharacterBible, 'intake');
    const sources = ctx.session.state['sources'] as Source[];
    const rubric = PortrayalRubric.parse({
      ...draft,
      trait: bible.trait,
      generated_at: new Date().toISOString(),
      sources,
    });
    const delta: Record<string, unknown> = { rubric };
    Object.assign(ctx.session.state, delta);
    yield createEvent({ author: this.name, actions: { stateDelta: delta } });
  }
}
