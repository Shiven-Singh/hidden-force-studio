import { BaseAgent, type InvocationContext, type Event } from '@google/adk';
import type { ZodType } from 'zod';

/**
 * Shared base for the code-only stages. ADK requires a live (bidirectional
 * streaming) implementation on every agent; this pipeline never runs live.
 */
export abstract class PipelineAgent extends BaseAgent {
  protected async *runLiveImpl(_ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    throw new Error(`${this.name} does not support live mode`);
  }

  /**
   * Read a required key from session state and validate it. An LlmAgent whose
   * model call failed leaves its outputKey unset and ADK moves on, so a missing
   * key here means an upstream stage produced nothing. Say which one.
   */
  protected read<T>(ctx: InvocationContext, key: string, schema: ZodType<T>, producedBy: string): T {
    const raw = ctx.session.state[key];
    if (raw === undefined || raw === null) {
      throw new Error(`${this.name}: state.${key} is missing; the ${producedBy} stage produced no output`);
    }
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new Error(`${this.name}: state.${key} from ${producedBy} failed validation: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    }
    return result.data;
  }
}
