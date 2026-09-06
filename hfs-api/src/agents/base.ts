import { BaseAgent, type InvocationContext, type Event } from '@google/adk';

/**
 * Shared base for the code-only stages. ADK requires a live (bidirectional
 * streaming) implementation on every agent; this pipeline never runs live.
 */
export abstract class PipelineAgent extends BaseAgent {
  protected async *runLiveImpl(_ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    throw new Error(`${this.name} does not support live mode`);
  }
}
