/**
 * The real pipeline with the three model-backed stages replaced by stubs.
 * Used by tests to drive the ADK runtime, the LoopAgent, the gate's escalate,
 * the HALT path, and the package writer without a network.
 */
import {
  InMemorySessionService,
  LoopAgent,
  Runner,
  SequentialAgent,
  createEvent,
  type BaseAgent,
  type Event,
  type InvocationContext,
} from '@google/adk';
import type { CharacterBible, LockedCharacter, PortrayalRubric, Screenplay } from '@hfs/schemas';
import { ArtDirectionAgent } from '../agents/art-direction.js';
import { PipelineAgent } from '../agents/base.js';
import { GateAgent, MAX_ITERATIONS, type Scorer } from '../agents/gate.js';
import { IntakeAgent } from '../agents/intake.js';
import { PackageAgent } from '../agents/package.js';

type Producer = (state: Record<string, unknown>) => Record<string, unknown>;

/** A stage that writes whatever `produce` returns into state. Stands in for an LlmAgent. */
class StateWriter extends PipelineAgent {
  private readonly produce: Producer;
  constructor(name: string, produce: Producer) {
    super({ name, description: `offline stub for ${name}` });
    this.produce = produce;
  }
  protected async *runAsyncImpl(ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    const delta = this.produce(ctx.session.state);
    Object.assign(ctx.session.state, delta);
    yield createEvent({ author: this.name, actions: { stateDelta: delta } });
  }
}

export interface OfflineOptions {
  rubric: PortrayalRubric;
  locked: LockedCharacter;
  /** Called once per loop iteration with the iteration number (1-based) and the current revision instructions. */
  draft: (iteration: number, revisionInstructions: string) => Screenplay;
  scorer: Scorer;
}

export function buildOfflinePipeline(o: OfflineOptions): BaseAgent {
  return new SequentialAgent({
    name: 'hidden_force_studio_offline',
    description: 'The pipeline with model stages stubbed.',
    subAgents: [
      new IntakeAgent(),
      new StateWriter('rubric_merge', () => ({ rubric: o.rubric, sources: o.rubric.sources, parallel_search_ids: [] })),
      new LoopAgent({
        name: 'draft_review_loop',
        maxIterations: MAX_ITERATIONS,
        subAgents: [
          new StateWriter('story', (st) =>
            ({ screenplay: o.draft(Number(st['iteration'] ?? 0) + 1, String(st['revision_instructions'] ?? '')) })),
          new GateAgent(o.scorer),
        ],
      }),
      new StateWriter('lock_character', () => ({ locked: o.locked })),
      new ArtDirectionAgent(),
      new PackageAgent(),
    ],
  });
}

export interface OfflineResult {
  authors: string[];
  state: Record<string, unknown>;
}

export async function runOffline(agent: BaseAgent, bible: CharacterBible): Promise<OfflineResult> {
  const appName = 'hfs-offline';
  const sessions = new InMemorySessionService();
  const runner = new Runner({ appName, agent, sessionService: sessions });
  const sessionId = `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await sessions.createSession({ appName, userId: 'test', sessionId, state: { bible_raw: bible, run_id: sessionId } });

  const authors: string[] = [];
  const state: Record<string, unknown> = {};
  for await (const ev of runner.runAsync({
    userId: 'test',
    sessionId,
    newMessage: { role: 'user', parts: [{ text: 'run' }] },
  })) {
    if (ev.author) authors.push(ev.author);
    if (ev.actions?.stateDelta) Object.assign(state, ev.actions.stateDelta);
  }
  return { authors, state };
}
