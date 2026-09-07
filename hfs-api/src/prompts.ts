/**
 * Every model instruction in one place. The ADK agents take instruction
 * providers (functions of the read-only context) rather than template strings,
 * so state objects are serialised deliberately instead of relying on
 * placeholder stringification.
 */
import type { ReadonlyContext } from '@google/adk';
import type { CharacterBible, PortrayalRubric, Screenplay, Source } from '@hfs/schemas';

const j = (v: unknown): string => JSON.stringify(v, null, 2);

/** Read a required key from the read-only context. Intake seeds every key, so a miss is a wiring bug. */
const need = <T,>(ctx: ReadonlyContext, key: string): T => {
  const v = ctx.state.get<T>(key);
  if (v === undefined) throw new Error(`state.${key} is missing`);
  return v;
};

/** The six Hidden Force leads. A draft for one must not reuse another's name for a side character. */
const RESERVED_NAMES = ['Zayan', 'Aanya', 'Kabir', 'Maya', 'Reyansh', 'Tara'];

const FOUNTAIN_PRIMER = `Fountain format, strictly:
- Scene headings start with INT. or EXT. in capitals, e.g. "INT. CLASSROOM - DAY".
- Action lines are plain sentences in present tense. This is the narrator's voice.
- A character cue is the character's name alone on a line in CAPITALS, followed by dialogue lines, then a blank line.
- Parentheticals go on their own line in (brackets) between cue and dialogue.
- Blank lines separate every block. No markdown, no bold, no numbering.`;

export const RUBRIC_INSTRUCTION = (ctx: ReadonlyContext): string => {
  const bible = need<CharacterBible>(ctx, 'bible');
  const sources = need<Source[]>(ctx, 'sources');
  const list = sources
    .map((s) => `[${s.idx}] pool=${s.pool} publisher=${s.publisher}\n${s.excerpt}`)
    .join('\n\n');
  return `You compile portrayal rubrics for children's animation aimed at ages 6 to 9.

The character: ${bible.name}, age ${bible.age}, ${bible.trait} (${bible.trait_clinical_name}).
The intended reframe of the trait: ${bible.reframe}.

Below are excerpts fetched today from the web. Sources in the "advocacy" pool come from disability and neurodiversity organisations and style guides. Sources in the "general" pool are the open web. Prefer the advocacy pool when they disagree.

${list}

Produce a rubric as JSON with these fields:
- must_do: at least 4 rules, ids MD1.., each with the index of the source that supports it in source_ref.
- must_not_do: at least 4 rules, ids MN1.., each with a source_ref.
- preferred_terms: identity-first or person-first phrasings the sources recommend for this trait.
- avoid_terms: exact words or phrases the sources say to avoid. Short, literal, lowercase. These are matched by regex against the script's action lines.

Rules must be concrete and checkable against a screenplay. "Be respectful" is not a rule. "The character's ${bible.trait} is present and unchanged in the final scene" is a rule.
Only cite a source index that actually supports the rule. If no source supports a rule you believe is important, leave it out.`;
};

export const STORY_INSTRUCTION = (ctx: ReadonlyContext): string => {
  const bible = need<CharacterBible>(ctx, 'bible');
  const rubric = need<PortrayalRubric>(ctx, 'rubric');
  const iteration = Number(ctx.state.get<number>('iteration') ?? 0);
  const revision = String(ctx.state.get<string>('revision_instructions') ?? '').trim();

  const revisionBlock = revision
    ? `THIS IS REVISION ${iteration}. The previous draft failed review. Fix these findings and change as little else as possible:
${revision}

The findings override the story premise. If the premise's ending is what caused a finding, rewrite the ending so the finding no longer applies. ${bible.name} keeps ${bible.trait} in the final scene, whatever the premise says.

`
    : '';

  const unguarded = bible.adversarial === true && (iteration === 0 || bible.adversarial_revisions === 'unguarded');
  if (unguarded) {
    // An unguarded revision sees the findings but treats the premise as fixed. That is
    // what a writer who has not accepted the notes does, and it is how the HALT path is shown.
    const unguardedRevision = revision
      ? `THIS IS REVISION ${iteration}. Review notes on the previous draft:
${revision}

Apply these notes only where they do not change the premise or its ending. The premise, including how it ends, is fixed and must be kept exactly.

`
      : '';
    return `You write animated shorts for children aged 6 to 9. Write the beat sheet and the screenplay for one short of 8 to 12 pages.

${unguardedRevision}CHARACTER BIBLE
${j(bible)}

Follow the story premise exactly as written, including how it ends. Do not soften, reinterpret, or add caveats to the premise. Never use these names for any character, not even a cameo: ${RESERVED_NAMES.filter((n) => n !== bible.name).join(', ')}. The story is set in a town in the United States and supporting characters have common American names.

${FOUNTAIN_PRIMER}

OUTPUT
JSON with: title, logline (one sentence), beats (10 to 15, each with number, title, summary, and trait_in_play saying how the trait is present in that beat), fountain (the complete screenplay, 1,500 to 3,000 words), page_estimate (integer), trait_causality_note (one sentence on why the trait matters to the resolution).`;
  }

  return `You write animated shorts for children aged 6 to 9. Write the beat sheet and the screenplay for one short of 8 to 12 pages.

${revisionBlock}CHARACTER BIBLE
${j(bible)}

PORTRAYAL RUBRIC, built today from cited sources. Every rule is checked after you write.
Must do:
${rubric.must_do.map((r) => `- ${r.id}: ${r.rule}`).join('\n')}
Must not do:
${rubric.must_not_do.map((r) => `- ${r.id}: ${r.rule}`).join('\n')}
Preferred terms: ${rubric.preferred_terms.join(', ')}
Never use in action lines: ${rubric.avoid_terms.join(', ')}

HARD CONSTRAINTS
1. ${bible.name} has ${bible.trait} in the last scene exactly as in the first. No cure, no outgrowing, no "learning to control it" as the ending.
2. The trait is the mechanism of the resolution. The problem is unsolvable without it. State this in one sentence in trait_causality_note.
3. The narrator's voice, meaning every action line, never frames the trait as a deficit. Other characters may hold that view and be proven wrong. That is the arc.
4. ${bible.name} wants something for themselves, named in the first two beats, that is not about helping or teaching anyone.
5. Name the trait plainly at least once, in dialogue or action: "${bible.trait}" or "${bible.trait_clinical_name}". No euphemisms.
6. The totem (${bible.totem}) appears at least twice.
7. Read-aloud rhythm. Short sentences in action lines. No tongue-twisters in dialogue.
8. Never use these names for any character in this short, not even a cameo: ${RESERVED_NAMES.filter((n) => n !== bible.name).join(', ')}. Invent other names for every supporting character.
9. The story is set in a town in the United States. Supporting characters, teachers and adults have common American first names and surnames.

${FOUNTAIN_PRIMER}

OUTPUT
JSON with: title, logline (one sentence), beats (10 to 15, each with number, title, summary, and trait_in_play saying how the trait is present in that beat), fountain (the complete screenplay, 1,500 to 3,000 words), page_estimate (integer), trait_causality_note.`;
};

export const LOCK_INSTRUCTION = (ctx: ReadonlyContext): string => {
  const bible = need<CharacterBible>(ctx, 'bible');
  const screenplay = need<Screenplay>(ctx, 'screenplay');
  return `You write character sheets for an animation studio. Produce the locked visual description for ${bible.name} from "${screenplay.title}".

Source facts:
- Physical description from the bible: ${bible.physical_description}
- Colour palette: ${bible.colour_palette.join(', ')}
- Totem: ${bible.totem}
- Age: ${bible.age}

Rules for locked_description:
- One paragraph, 60 to 120 words, present tense, concrete visual facts only: build, skin, hair, face, clothing with specific colours, footwear, the totem, posture at rest, and any assistive equipment as part of the character's design rather than as a medical object.
- No emotion, no story, no adjectives about personality. This paragraph will be pasted verbatim into every shot prompt and hashed, so it must stand alone.
- Never mention what the character cannot do.

turnarounds: exactly four strings, each "<the full locked_description> Turnaround view: front." then three-quarter, profile, back.
expressions: four strings naming an expression and how it reads on this face: delighted, frustrated, focused, worried.
negative_prompts: at least six, including "no pity framing", "not seated apart from the group", "no medical setting", "no photorealism", and any specific to this character.`;
};

export interface GatePromptInput {
  bible: CharacterBible;
  rubric: PortrayalRubric;
  fountain: string;
  causality: string;
}

/** The rule ids the model is asked to score. HF2 and the SC-* checks are code. */
export const modelRuleIds = (rubric: PortrayalRubric): string[] => [
  'HF1',
  'HF3',
  ...rubric.must_do.map((r) => r.id),
  ...rubric.must_not_do.map((r) => r.id),
];

export const GATE_INSTRUCTION = ({ bible, rubric, fountain, causality }: GatePromptInput): string => {
  const ids = modelRuleIds(rubric);
  return `You are the review gate for a children's animated short. You score a screenplay against explicit rules and you never invent evidence.

CHARACTER: ${bible.name}, age ${bible.age}, ${bible.trait} (${bible.trait_clinical_name}). Intended reframe: ${bible.reframe}.

RULES TO SCORE, one JSON object per rule id, in this order: ${ids.join(', ')}
- HF1 (cure narrative): the trait must be present and unchanged in the final scene. Fail if it is removed, reduced, outgrown, medicated away, or if "controlling it" is the resolution. Evidence must come from the final two scenes.
- HF3 (inspiration porn): ${bible.name} must want something for themselves, independent of helping or teaching anyone, and must have interiority. Fail if the character exists to teach others a lesson or is valued only when useful.
${rubric.must_do.map((r) => `- ${r.id} (must do): ${r.rule}`).join('\n')}
${rubric.must_not_do.map((r) => `- ${r.id} (must not do): ${r.rule}`).join('\n')}

Note: deficit language in action lines is checked separately by code. Dialogue spoken by other characters is allowed to hold a deficit view; that is the story's arc, not a violation.

The writer's own claim about causality: "${causality}". Check it against the script, do not take it on trust.

EVIDENCE RULE
The "evidence" field must be one line copied verbatim from the script below, character for character. It is verified by exact string match. If you cannot find a line that proves your result, set result to "unclear" and copy the closest relevant line.

SCRIPT
${fountain}

Return a JSON array of objects: { rule_id, result: "pass" | "fail" | "unclear", evidence, note }.`;
};
