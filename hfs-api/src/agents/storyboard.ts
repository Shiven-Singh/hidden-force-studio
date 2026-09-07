import { createEvent, type InvocationContext, type Event } from '@google/adk';
import { PipelineAgent } from './base.js';
import { ArtBrief, CharacterBible, type ReviewReport } from '@hfs/schemas';
import { STILL_MODEL, STYLE, generateStill, mapLimit, saveRunFile, toJpeg } from '../clients/media.js';
import { localRunDir } from '../output-folder.js';
import path from 'node:path';

export interface StoryboardFrame {
  shot: number;
  beat: number;
  file: string;
  prompt: string;
  error?: string;
}

/**
 * Stage 5b. One still per shot, drawn from the locked description so the
 * character is the same in every frame. Runs only after a PASS, three images
 * at a time. A failed frame is recorded, not fatal.
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

    const frames = await mapLimit(brief.shots, 3, async (shot): Promise<StoryboardFrame> => {
      const file = `storyboard/shot_${String(shot.number).padStart(2, '0')}.jpg`;
      const prompt = `${STYLE} ${shot.prompt} Colour palette: ${bible.colour_palette.join(', ')}.`;
      try {
        const png = await generateStill(prompt);
        const local = path.join(localRunDir(folder), file);
        await toJpeg(png, local);
        const { readFile } = await import('node:fs/promises');
        await saveRunFile(folder, file, await readFile(local), 'image/jpeg');
        return { shot: shot.number, beat: shot.beat, file, prompt };
      } catch (err) {
        return { shot: shot.number, beat: shot.beat, file, prompt, error: err instanceof Error ? err.message.slice(0, 200) : String(err) };
      }
    });

    const timings = { ...((st['stage_timings_ms'] as Record<string, number> | undefined) ?? {}) };
    timings.storyboard = Date.now() - started;
    const delta: Record<string, unknown> = {
      storyboard: { model: STILL_MODEL, style: STYLE, frames },
      stage_timings_ms: timings,
    };
    Object.assign(st, delta);
    yield createEvent({ author: this.name, actions: { stateDelta: delta } });
  }
}
