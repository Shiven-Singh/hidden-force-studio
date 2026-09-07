import { createEvent, type InvocationContext, type Event } from '@google/adk';
import { PipelineAgent } from './base.js';
import { CharacterBible } from '@hfs/schemas';
import { outputFolderName } from '../output-folder.js';

/** Stage 1. Validates the bible and seeds every state key the later stages read. */
export class IntakeAgent extends PipelineAgent {
  constructor() {
    super({ name: 'intake', description: 'Validates the character bible and seeds pipeline state.' });
  }

  protected async *runAsyncImpl(ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    const started = Date.now();
    const bible = CharacterBible.parse(ctx.session.state['bible_raw']);
    const delta: Record<string, unknown> = {
      bible,
      output_folder: outputFolderName(bible),
      iteration: 0,
      revision_instructions: '',
      review_history: [],
      started_at: new Date().toISOString(),
      stage_timings_ms: { intake: Date.now() - started },
    };
    Object.assign(ctx.session.state, delta);
    yield createEvent({ author: this.name, actions: { stateDelta: delta } });
  }
}
