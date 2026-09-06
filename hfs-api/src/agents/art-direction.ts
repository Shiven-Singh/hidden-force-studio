import { createHash } from 'node:crypto';
import { createEvent, type InvocationContext, type Event } from '@google/adk';
import { PipelineAgent } from './base.js';
import { ArtBrief, CharacterBible, LockedCharacter, Screenplay, type ReviewReport, type Shot } from '@hfs/schemas';

const CAMERAS = ['wide establishing', 'medium', 'close-up', 'over the shoulder', 'low angle', 'tracking'];
const LIGHTS = ['soft morning light', 'flat overcast light', 'hard afternoon light', 'warm interior light', 'cool dusk light'];
const MIN_SHOTS = 12;

const sceneHeadings = (fountain: string): string[] =>
  fountain.split('\n').map((l) => l.trim()).filter((l) => /^(INT|EXT|EST|I\/E)[\s./]/i.test(l));

/**
 * Stage 5. The locked description comes from the lock LlmAgent; everything
 * else here is code, so the character paragraph is injected verbatim and the
 * hash is honest about what it proves: that the paragraph never changed.
 */
export class ArtDirectionAgent extends PipelineAgent {
  constructor() {
    super({ name: 'art_direction', description: 'Locks the character sheet and emits one prompt per shot.' });
  }

  protected async *runAsyncImpl(ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    const st = ctx.session.state;
    const review = st['review'] as ReviewReport | undefined;
    if (review?.verdict !== 'PASS') {
      yield createEvent({ author: this.name, actions: { stateDelta: { art_direction_skipped: review?.verdict ?? 'NO_REVIEW' } } });
      return;
    }

    const started = Date.now();
    const bible = CharacterBible.parse(st['bible']);
    const sp = Screenplay.parse(st['screenplay']);
    const rawLocked = st['locked'];
    const locked = LockedCharacter.parse(typeof rawLocked === 'string' ? JSON.parse(rawLocked) : rawLocked);
    const headings = sceneHeadings(sp.fountain);

    const shots: Shot[] = [];
    let n = 0;
    for (let pass = 0; shots.length < Math.max(MIN_SHOTS, sp.beats.length); pass++) {
      for (const beat of sp.beats) {
        if (pass > 0 && shots.length >= Math.max(MIN_SHOTS, sp.beats.length)) break;
        const heading = headings[Math.min(beat.number - 1, headings.length - 1)] ?? 'INT. UNSPECIFIED - DAY';
        const camera = CAMERAS[(n + pass) % CAMERAS.length];
        const light = LIGHTS[n % LIGHTS.length];
        shots.push({
          number: ++n,
          beat: beat.number,
          scene_heading: heading,
          camera,
          palette: bible.colour_palette,
          prompt:
            `${locked.locked_description} Scene: ${beat.summary} Setting: ${heading}. ` +
            `Camera: ${camera}. Light: ${light}. Palette: ${bible.colour_palette.join(', ')}. ` +
            `Avoid: ${locked.negative_prompts.join('; ')}.`,
        });
      }
      if (pass > 0) break;
    }

    const brief = ArtBrief.parse({
      character: locked,
      consistency_hash: createHash('sha256').update(locked.locked_description).digest('hex'),
      shots,
    });

    const timings = { ...((st['stage_timings_ms'] as Record<string, number> | undefined) ?? {}) };
    timings.art_direction = Date.now() - started;
    const delta: Record<string, unknown> = { art_brief: brief, stage_timings_ms: timings };
    Object.assign(st, delta);
    yield createEvent({ author: this.name, actions: { stateDelta: delta } });
  }
}
