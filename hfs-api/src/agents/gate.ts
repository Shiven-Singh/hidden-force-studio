import { createEvent, type InvocationContext, type Event } from '@google/adk';
import { PipelineAgent } from './base.js';
import { CharacterBible, PortrayalRubric, Screenplay, type ReviewReport, type RuleScore } from '@hfs/schemas';
import { runDeterministicChecks, verifyEvidence } from '../gate/checks.js';
import { scoreWithModel } from '../clients/gemini.js';

const COLOURS = ['White', 'Blue', 'Pink'] as const;
export const MAX_ITERATIONS = COLOURS.length;

export type Scorer = (sp: Screenplay, rubric: PortrayalRubric, bible: CharacterBible) => Promise<RuleScore[]>;

/**
 * Decides a verdict from deterministic and model scores. Pure, so the tests
 * can drive it without a model. Hard rules fail on anything but "pass".
 * Must-do rules fail only on an explicit "fail".
 */
export function decide(
  det: RuleScore[],
  model: RuleScore[],
  unverified: string[],
  rubric: PortrayalRubric,
  iteration: number,
): ReviewReport {
  const hardIds = new Set(['HF1', 'HF2', 'HF3', ...rubric.must_not_do.map((r) => r.id)]);
  const mustIds = new Set(rubric.must_do.map((r) => r.id));
  const all = [...det, ...model];

  const hard = all
    .filter((s) => (hardIds.has(s.rule_id) && s.result !== 'pass') || (mustIds.has(s.rule_id) && s.result === 'fail'))
    .map((s) => s.rule_id);
  const soft = all
    .filter((s) => s.rule_id.startsWith('SC-') && s.result !== 'pass')
    .map((s) => `${s.rule_id}: ${s.note}`);

  const verdict: ReviewReport['verdict'] = hard.length === 0 ? 'PASS' : iteration < MAX_ITERATIONS ? 'REVISE' : 'HALT';
  const instructions = all
    .filter((s) => hard.includes(s.rule_id))
    .map((s) => `${s.rule_id} failed. Evidence: "${s.evidence}". ${s.note}`.trim());

  return {
    verdict,
    iteration,
    revision_colour: COLOURS[Math.min(iteration, MAX_ITERATIONS) - 1],
    deterministic: det,
    model_scored: model,
    hard_failures: hard,
    soft_notes: soft,
    revision_instructions: instructions,
    evidence_unverified: unverified,
  };
}

/** Stage 4. Sits inside the LoopAgent after the story agent. Escalates on PASS to end the loop. */
export class GateAgent extends PipelineAgent {
  private readonly scorer: Scorer;

  constructor(scorer: Scorer = scoreWithModel) {
    super({ name: 'gate', description: 'Scores the draft against the rubric, verifies evidence, decides.' });
    this.scorer = scorer;
  }

  protected async *runAsyncImpl(ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    const started = Date.now();
    const st = ctx.session.state;
    const bible = this.read(ctx, 'bible', CharacterBible, 'intake');
    const rubric = this.read(ctx, 'rubric', PortrayalRubric, 'rubric');
    const sp = this.read(ctx, 'screenplay', Screenplay, 'story');
    const iteration = Number(st['iteration'] ?? 0) + 1;

    const det = runDeterministicChecks(sp, rubric, bible);
    const { scores: model, unverified } = verifyEvidence(await this.scorer(sp, rubric, bible), sp.fountain);
    const report = decide(det, model, unverified, rubric, iteration);

    const history = [...((st['review_history'] as ReviewReport[] | undefined) ?? []), report];
    const timings = { ...((st['stage_timings_ms'] as Record<string, number> | undefined) ?? {}) };
    timings[`gate_${report.revision_colour.toLowerCase()}`] = Date.now() - started;

    const delta: Record<string, unknown> = {
      review: report,
      iteration,
      review_history: history,
      revision_instructions: report.revision_instructions.join('\n'),
      stage_timings_ms: timings,
    };
    Object.assign(st, delta);

    yield createEvent({
      author: this.name,
      actions: { stateDelta: delta, escalate: report.verdict === 'PASS' },
    });
  }
}
