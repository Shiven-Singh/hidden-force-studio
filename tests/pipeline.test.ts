/**
 * Drives the real ADK runtime end to end with the model stages stubbed.
 * Proves: the loop exits on PASS, revises on REVISE, halts after Pink,
 * art direction refuses after a HALT, and the package writer produces the
 * right files in each case.
 */
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ArtBrief, CharacterBible, LockedCharacter, PortrayalRubric, ReviewReport, RuleScore, RunManifest, Screenplay } from '@hfs/schemas';
import { buildOfflinePipeline, runOffline } from '../hfs-api/src/testing/offline-pipeline.js';
import { modelRuleIds } from '../hfs-api/src/prompts.js';

const bible: CharacterBible = {
  name: 'Maya', pronunciation: 'MY-ah', age: 9, trait: 'wheelchair user',
  trait_clinical_name: 'spinal cord injury', reframe: 'her chair is engineered tech',
  physical_description: 'curly hair, teal windbreaker, manual wheelchair with orange spoke guards',
  strengths: ['fixes anything with wheels', 'plans ahead'], vulnerabilities: ['hates unasked help'],
  fear_carried_in: 'that people see the chair first', story_premise: 'a flood turns the town into ramps',
  colour_palette: ['#2A9D8F', '#F4A261'], totem: 'a small wrench on a lanyard',
};

const rubric: PortrayalRubric = {
  trait: 'wheelchair user', generated_at: '2026-09-06T00:00:00Z',
  sources: [{ idx: 0, title: 'Style guide', url: 'https://ncdj.org/style-guide/', publisher: 'ncdj.org', publish_date: null, retrieved: '2026-09-06', excerpt: 'x', pool: 'advocacy' }],
  must_do: [{ id: 'MD1', rule: 'trait causally necessary', source_ref: 0 }, { id: 'MD2', rule: 'difficulty acknowledged', source_ref: 0 }],
  must_not_do: [{ id: 'MN1', rule: 'no cure', source_ref: 0 }, { id: 'MN2', rule: 'no deficit narration', source_ref: 0 }],
  preferred_terms: ['uses a wheelchair'], avoid_terms: ['confined to'],
};

const locked: LockedCharacter = {
  locked_description: 'Maya is nine, with curly black hair tied high, a teal windbreaker, fingerless gloves, and a manual wheelchair with orange spoke guards.',
  turnarounds: ['front', 'three-quarter', 'profile', 'back'],
  expressions: ['delighted', 'frustrated', 'focused', 'worried'],
  negative_prompts: ['no pity framing', 'no medical setting'],
};

const CURE_LINE = 'Maya stands up out of the chair and walks to the door.';

const beats = Array.from({ length: 10 }, (_, i) => ({ number: i + 1, title: `Beat ${i + 1}`, summary: `Something happens in beat ${i + 1}.`, trait_in_play: 'the chair' }));

const draftWith = (ending: string): Screenplay => ({
  title: 'Wheels on Water', logline: 'A flood, a girl, a chair.', beats, page_estimate: 9,
  trait_causality_note: 'wheels beat legs in a flooded town',
  fountain: `INT. WORKSHOP - DAY

Maya tightens a bolt on her wheelchair user badge and grins.

MAYA
Today I get the river.

EXT. FLOODED STREET - LATER

Water fills the road. Maya rolls onto the ramp she built.

${ending}
`,
});

const CLEAN = draftWith('Maya rolls through the doorway, wrench in hand, and the town follows her.');
const CURE = draftWith(CURE_LINE);

/** Quotes a real line for every rule so verification passes; fails HF1 when the cure line is present. */
const scorer = async (sp: Screenplay, r: PortrayalRubric): Promise<RuleScore[]> => {
  const first = sp.fountain.split('\n').find((l) => l.trim() && !l.startsWith('INT') && !l.startsWith('EXT'))!.trim();
  const cure = sp.fountain.includes(CURE_LINE);
  return modelRuleIds(r).map((id) => ({
    rule_id: id,
    result: id === 'HF1' && cure ? 'fail' : 'pass',
    evidence: id === 'HF1' && cure ? CURE_LINE : first,
    note: id === 'HF1' && cure ? 'she walks in the final scene' : '',
  }));
};

let outDir: string;
beforeAll(async () => {
  outDir = await mkdtemp(path.join(tmpdir(), 'hfs-'));
  process.env.OUTPUT_DIR = outDir;
});
afterAll(() => { delete process.env.OUTPUT_DIR; });

const folders = async () => (await readdir(outDir)).sort();
const filesIn = async (folder: string) => (await readdir(path.join(outDir, folder))).sort();

describe('offline pipeline through the ADK runtime', () => {
  it('passes a clean draft on White and runs every downstream stage', async () => {
    const { authors, state } = await runOffline(buildOfflinePipeline({ rubric, locked, scorer, draft: () => CLEAN }), bible);
    const review = state['review'] as ReviewReport;
    expect(review.verdict).toBe('PASS');
    expect(review.revision_colour).toBe('White');
    expect((state['review_history'] as ReviewReport[]).length).toBe(1);
    expect(authors.filter((a) => a === 'gate').length).toBe(1);
    expect(authors).toContain('art_direction');
    expect(authors).toContain('package');

    const brief = state['art_brief'] as ArtBrief;
    expect(brief.consistency_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(brief.shots.length).toBeGreaterThanOrEqual(12);
    expect(brief.shots.every((s) => s.prompt.startsWith(locked.locked_description))).toBe(true);

    const [folder] = (await folders()).filter((f) => f.startsWith('maya_') && !f.includes('adversarial'));
    expect(await filesIn(folder)).toEqual([
      'art_brief.json', 'beat_sheet.md', 'one_sheet.md', 'portrayal_rubric.json',
      'review_history.json', 'run_manifest.json', 'screenplay.fountain', 'screenplay.json',
    ]);
    const manifest = JSON.parse(await readFile(path.join(outDir, folder, 'run_manifest.json'), 'utf8')) as RunManifest;
    expect(manifest.verdict).toBe('PASS');
    expect(manifest.iterations).toBe(1);
    expect(manifest.source_urls).toEqual(['https://ncdj.org/style-guide/']);
    expect(manifest.adk_version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('revises once and passes on Blue when the redraft fixes the finding', async () => {
    const drafts: string[] = [];
    const draft = (iteration: number, instructions: string) => {
      drafts.push(instructions);
      return iteration === 1 ? CURE : CLEAN;
    };
    const { state } = await runOffline(buildOfflinePipeline({ rubric, locked, scorer, draft }), bible);
    const history = state['review_history'] as ReviewReport[];
    expect(history.map((h) => h.verdict)).toEqual(['REVISE', 'PASS']);
    expect(history.map((h) => h.revision_colour)).toEqual(['White', 'Blue']);
    expect(drafts[0]).toBe('');
    expect(drafts[1]).toContain('HF1 failed');
    expect(drafts[1]).toContain(CURE_LINE);
  });

  it('halts after Pink when the cure never goes away, and refuses to art-direct', async () => {
    const adversarial = { ...bible, adversarial: true };
    const { authors, state } = await runOffline(buildOfflinePipeline({ rubric, locked, scorer, draft: () => CURE }), adversarial);
    const history = state['review_history'] as ReviewReport[];
    expect(history.map((h) => h.verdict)).toEqual(['REVISE', 'REVISE', 'HALT']);
    expect(history.map((h) => h.revision_colour)).toEqual(['White', 'Blue', 'Pink']);
    expect(authors.filter((a) => a === 'gate').length).toBe(3);
    expect(state['art_direction_skipped']).toBe('HALT');
    expect(state['art_brief']).toBeUndefined();

    const [folder] = (await folders()).filter((f) => f.includes('adversarial'));
    expect(await filesIn(folder)).toEqual([
      'beat_sheet.md', 'portrayal_rubric.json', 'review_history.json', 'run_manifest.json', 'screenplay.json', 'screenplay.rejected.fountain',
    ]);
    const manifest = JSON.parse(await readFile(path.join(outDir, folder, 'run_manifest.json'), 'utf8')) as RunManifest;
    expect(manifest.verdict).toBe('HALT');
    expect(manifest.iterations).toBe(3);
  });
});
