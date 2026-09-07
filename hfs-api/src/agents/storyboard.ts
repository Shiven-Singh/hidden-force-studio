import { createEvent, type InvocationContext, type Event } from '@google/adk';
import { PipelineAgent } from './base.js';
import { ArtBrief, CharacterBible, type ReviewReport } from '@hfs/schemas';
import { drawStoryboard, type StoryboardFrame } from '../clients/media.js';

export type { StoryboardFrame };

/**
 * Stage 5b. One still per shot, drawn from the locked description so the
 * character is the same in every frame. Runs only after a PASS, one image at
 * a time because that is what the image quota allows. A failed frame is
 * recorded, not fatal, and can be redrawn later through the API.
 */
export class StoryboardAgent extends PipelineAgent {
  constructor() {
    super({ name: 'storyboard', description: 'Draws one still per shot from the locked character description.' });
  }

  protected async *runAsyncImpl(ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    const st = ctx.session.state;
    const review = st['review'] as ReviewReport | undefined;
    if (review?.verdict !== 'PASS') {
      yield createEvent({ author: this.name, actions: { stateDelta: { storyboard_skipped: review?.verdict ?? 'NO_REVIEW' } } });
      return;
    }

    const started = Date.now();
    const bible = this.read(ctx, 'bible', CharacterBible, 'intake');
    const brief = this.read(ctx, 'art_brief', ArtBrief, 'art_direction');
    const folder = String(st['output_folder']);

    const board = await drawStoryboard(folder, brief.shots, bible.colour_palette, undefined, (done, total) => {
      st['storyboard_progress'] = { done, total };
    });

    const timings = { ...((st['stage_timings_ms'] as Record<string, number> | undefined) ?? {}) };
    timings.storyboard = Date.now() - started;
    const delta: Record<string, unknown> = { storyboard: board, stage_timings_ms: timings };
    Object.assign(st, delta);
    yield createEvent({ author: this.name, actions: { stateDelta: delta } });
  }
}
