/**
 * Direct Gemini calls on Vertex AI, used where the gate needs a structured
 * answer outside the ADK agent loop. The ADK agents themselves also talk to
 * Gemini on Vertex; GOOGLE_GENAI_USE_VERTEXAI=1 routes both.
 */
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { RuleScore, type CharacterBible, type PortrayalRubric, type Screenplay } from '@hfs/schemas';
import { GATE_INSTRUCTION, NARRATION_INSTRUCTION, type NarrationInput } from '../prompts.js';
import { HTTP_OPTIONS } from './http.js';

export const DRAFT_MODEL = process.env.DRAFT_MODEL ?? 'gemini-3.5-flash';
export const REVIEW_MODEL = process.env.REVIEW_MODEL ?? 'gemini-3.1-pro';

let client: GoogleGenAI | undefined;
function ai(): GoogleGenAI {
  client ??= new GoogleGenAI({
    vertexai: true,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1',
  });
  return client;
}

const Scores = z.array(RuleScore);

/** Ask the review model to score HF1, HF3 and the rubric rules. Evidence is verified afterwards in code. */
export async function scoreWithModel(sp: Screenplay, rubric: PortrayalRubric, bible: CharacterBible): Promise<RuleScore[]> {
  const res = await ai().models.generateContent({
    model: REVIEW_MODEL,
    contents: GATE_INSTRUCTION({ bible, rubric, fountain: sp.fountain, causality: sp.trait_causality_note }),
    config: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseJsonSchema: z.toJSONSchema(Scores),
      httpOptions: { ...HTTP_OPTIONS, retryOptions: { ...HTTP_OPTIONS.retryOptions } },
    },
  });
  return Scores.parse(JSON.parse(res.text ?? '[]'));
}

/** One narration line per film moment, from the drafting model. */
export async function narrate(input: NarrationInput): Promise<string[]> {
  const Lines = z.array(z.string());
  const res = await ai().models.generateContent({
    model: DRAFT_MODEL,
    contents: NARRATION_INSTRUCTION(input),
    config: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseJsonSchema: z.toJSONSchema(Lines),
      httpOptions: { ...HTTP_OPTIONS, retryOptions: { ...HTTP_OPTIONS.retryOptions } },
    },
  });
  const lines = Lines.parse(JSON.parse(res.text ?? '[]'));
  if (lines.length !== input.moments.length) throw new Error(`narration returned ${lines.length} lines for ${input.moments.length} moments`);
  return lines;
}

/** One-line smoke test used by `pnpm --filter hfs-api smoke`. */
export async function smoke(model: string): Promise<string> {
  const res = await ai().models.generateContent({
    model,
    contents: 'Reply with the single word: ready',
    config: { httpOptions: { timeout: 60_000 } },
  });
  return (res.text ?? '').trim();
}
