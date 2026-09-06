import { describe, expect, it } from 'vitest';
import type { CharacterBible, PortrayalRubric, RuleScore, Screenplay } from '@hfs/schemas';
import { checkDeficitLanguage, checkTraitNamed, runDeterministicChecks, verifyEvidence } from '../hfs-api/src/gate/checks.js';
import { decide } from '../hfs-api/src/agents/gate.js';

const bible: CharacterBible = {
  name: 'Maya', pronunciation: 'MY-ah', age: 9, trait: 'wheelchair user',
  trait_clinical_name: 'spinal cord injury', reframe: 'her chair is engineered tech',
  physical_description: 'test', strengths: ['a', 'b'], vulnerabilities: ['c'],
  fear_carried_in: 'test', story_premise: 'test', colour_palette: ['#000'], totem: 'a wrench',
};

const rubric: PortrayalRubric = {
  trait: 'wheelchair user', generated_at: '2026-09-06T00:00:00Z', sources: [],
  must_do: [{ id: 'MD1', rule: 'trait causally necessary', source_ref: 0 }, { id: 'MD2', rule: 'difficulty acknowledged', source_ref: 0 }],
  must_not_do: [{ id: 'MN1', rule: 'no cure', source_ref: 0 }, { id: 'MN2', rule: 'no deficit narration', source_ref: 0 }],
  preferred_terms: ['uses a wheelchair'], avoid_terms: ['confined to', 'wheelchair-bound'],
};

const beats = Array.from({ length: 10 }, (_, i) => ({ number: i + 1, title: `Beat ${i + 1}`, summary: 'x', trait_in_play: 'chair' }));

const screenplay = (fountain: string): Screenplay => ({
  title: 'Test', logline: 'x', beats, fountain, page_estimate: 9, trait_causality_note: 'wheels beat legs',
});

const ACTION_VIOLATION = `INT. HALL - DAY

Maya, confined to a wheelchair, waits by the door.

MAYA
Let's go.`;

const DIALOGUE_ONLY = `INT. HALL - DAY

Maya spins her chair toward the door. Her wheelchair user badge glints.

BULLY
You're confined to that thing forever.

MAYA
It's faster than you.`;

describe('HF2 deficit language', () => {
  it('fails on an avoid-list phrase in an action line', () => {
    const s = checkDeficitLanguage(screenplay(ACTION_VIOLATION), rubric);
    expect(s.result).toBe('fail');
    expect(s.evidence).toContain('confined to a wheelchair');
  });

  it('passes when the same phrase is only in dialogue', () => {
    expect(checkDeficitLanguage(screenplay(DIALOGUE_ONLY), rubric).result).toBe('pass');
  });
});

describe('SC-NAMED', () => {
  it('passes when the trait is named plainly', () => {
    expect(checkTraitNamed(screenplay(DIALOGUE_ONLY), bible).result).toBe('pass');
  });
  it('fails when it never is', () => {
    expect(checkTraitNamed(screenplay('INT. A - DAY\n\nShe rolls in.'), bible).result).toBe('fail');
  });
});

describe('verifyEvidence', () => {
  it('turns an invented quote into unclear and lists it', () => {
    const scores: RuleScore[] = [
      { rule_id: 'HF1', result: 'pass', evidence: 'Maya spins her chair toward the door.', note: '' },
      { rule_id: 'HF3', result: 'pass', evidence: 'This line is not in the script.', note: '' },
    ];
    const { scores: out, unverified } = verifyEvidence(scores, DIALOGUE_ONLY);
    expect(out[0].result).toBe('pass');
    expect(out[1].result).toBe('unclear');
    expect(unverified).toEqual(['HF3']);
  });

  it('is tolerant of curly quotes and whitespace', () => {
    const scores: RuleScore[] = [{ rule_id: 'HF1', result: 'pass', evidence: 'It’s   faster than you.', note: '' }];
    expect(verifyEvidence(scores, DIALOGUE_ONLY).unverified).toEqual([]);
  });
});

describe('decide', () => {
  const pass = (id: string): RuleScore => ({ rule_id: id, result: 'pass', evidence: 'x', note: '' });
  const fail = (id: string): RuleScore => ({ rule_id: id, result: 'fail', evidence: 'she stands and walks', note: 'cure' });
  const det = runDeterministicChecks(screenplay(DIALOGUE_ONLY), rubric, bible).map((s) => ({ ...s, result: 'pass' as const }));

  it('passes a clean draft on White', () => {
    const r = decide(det, ['HF1', 'HF3', 'MD1', 'MD2', 'MN1', 'MN2'].map(pass), [], rubric, 1);
    expect(r.verdict).toBe('PASS');
    expect(r.revision_colour).toBe('White');
  });

  it('revises on an HF1 failure at iteration 1 and 2', () => {
    const r1 = decide(det, [fail('HF1'), pass('HF3'), pass('MD1'), pass('MD2'), pass('MN1'), pass('MN2')], [], rubric, 1);
    expect(r1.verdict).toBe('REVISE');
    expect(r1.revision_instructions[0]).toContain('HF1 failed');
    const r2 = decide(det, [fail('HF1'), pass('HF3'), pass('MD1'), pass('MD2'), pass('MN1'), pass('MN2')], [], rubric, 2);
    expect(r2.verdict).toBe('REVISE');
    expect(r2.revision_colour).toBe('Blue');
  });

  it('halts on the third failure', () => {
    const r = decide(det, [fail('HF1'), pass('HF3'), pass('MD1'), pass('MD2'), pass('MN1'), pass('MN2')], [], rubric, 3);
    expect(r.verdict).toBe('HALT');
    expect(r.revision_colour).toBe('Pink');
  });

  it('treats unverified evidence on a hard rule as a failure', () => {
    const scores = ['HF1', 'HF3', 'MD1', 'MD2', 'MN1', 'MN2'].map(pass);
    scores[0].result = 'unclear';
    const r = decide(det, scores, ['HF1'], rubric, 1);
    expect(r.verdict).toBe('REVISE');
    expect(r.hard_failures).toEqual(['HF1']);
  });

  it('does not fail a must-do rule on unclear', () => {
    const scores = ['HF1', 'HF3', 'MD1', 'MD2', 'MN1', 'MN2'].map(pass);
    scores[2].result = 'unclear';
    expect(decide(det, scores, ['MD1'], rubric, 1).verdict).toBe('PASS');
  });
});
