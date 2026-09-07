/**
 * The deterministic half of the gate. Nothing in this file calls a model.
 */
import type { CharacterBible, PortrayalRubric, RuleScore, Screenplay } from '@hfs/schemas';
import { splitFountain } from './fountain.js';

/** Applies to every trait regardless of what the research stage returned. */
export const FLOOR_AVOID: RegExp[] = [
  /suffers? from/i,
  /confined to/i,
  /wheelchair[- ]bound/i,
  /differently[- ]abled/i,
  /special needs/i,
  /despite (his|her|their) (condition|disability|disorder)/i,
  /normal (kids|children|boy|girl)/i,
  /afflicted/i,
  /victim of/i,
  /overc[ao]me (his|her|their)/i,
  /in spite of (his|her|their)/i,
  /brave(ly)? (for|despite)/i,
];

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** HF2. Scans action lines only. Dialogue is exempt by construction. */
export function checkDeficitLanguage(sp: Screenplay, rubric: PortrayalRubric): RuleScore {
  const { action } = splitFountain(sp.fountain);
  const patterns = [
    ...FLOOR_AVOID,
    ...rubric.avoid_terms.filter((t) => t.trim()).map((t) => new RegExp(`\\b${escapeRegex(t.trim())}\\b`, 'i')),
  ];
  for (const line of action) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        return {
          rule_id: 'HF2',
          result: 'fail',
          evidence: line,
          note: `avoid-list match "${match[0]}" in an action line`,
        };
      }
    }
  }
  return {
    rule_id: 'HF2',
    result: 'pass',
    evidence: action[0] ?? '',
    note: 'no avoid-list match in action lines',
  };
}

/** SC-NAMED. The trait or its clinical name appears plainly at least once. */
export function checkTraitNamed(sp: Screenplay, bible: CharacterBible): RuleScore {
  const lines = sp.fountain.split('\n');
  for (const name of [bible.trait, bible.trait_clinical_name]) {
    const needle = name.toLowerCase();
    const hit = lines.find((l) => l.toLowerCase().includes(needle));
    if (hit) return { rule_id: 'SC-NAMED', result: 'pass', evidence: hit.trim(), note: `found "${name}"` };
  }
  return { rule_id: 'SC-NAMED', result: 'fail', evidence: '', note: 'trait never named plainly' };
}

/** SC-LENGTH. 8 to 12 pages, 1,500 to 3,000 words. */
export function checkLength(sp: Screenplay): RuleScore {
  const words = sp.fountain.split(/\s+/).filter(Boolean).length;
  const ok = sp.page_estimate >= 8 && sp.page_estimate <= 12 && words >= 1500 && words <= 3000;
  return {
    rule_id: 'SC-LENGTH',
    result: ok ? 'pass' : 'fail',
    evidence: sp.fountain.split('\n').find((l) => l.trim()) ?? '',
    note: `${words} words, ~${sp.page_estimate} pages`,
  };
}

/** SC-BEATS. Every beat says how the trait is present. */
export function checkBeats(sp: Screenplay): RuleScore {
  const empty = sp.beats.filter((b) => !b.trait_in_play.trim()).map((b) => b.number);
  return {
    rule_id: 'SC-BEATS',
    result: empty.length ? 'fail' : 'pass',
    evidence: sp.beats.at(-1)?.summary ?? '',
    note: empty.length ? `beats missing trait_in_play: [${empty.join(', ')}]` : 'every beat carries the trait',
  };
}

export function runDeterministicChecks(sp: Screenplay, rubric: PortrayalRubric, bible: CharacterBible): RuleScore[] {
  return [checkDeficitLanguage(sp, rubric), checkTraitNamed(sp, bible), checkLength(sp), checkBeats(sp)];
}

const normalise = (s: string): string =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * Fail closed. A score whose evidence is not a verbatim line of the script
 * becomes "unclear", which the verdict logic treats as a failure on hard rules.
 */
export function verifyEvidence(scores: RuleScore[], fountain: string): { scores: RuleScore[]; unverified: string[] } {
  const hay = normalise(fountain);
  const unverified: string[] = [];
  for (const s of scores) {
    const needle = normalise(s.evidence);
    if (!needle || !hay.includes(needle)) {
      s.result = 'unclear';
      s.note = [s.note, 'evidence not found verbatim in script'].filter(Boolean).join(' | ');
      unverified.push(s.rule_id);
    }
  }
  return { scores, unverified };
}
