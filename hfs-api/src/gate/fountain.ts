/**
 * Splits a Fountain screenplay into the narrator's voice (action lines) and
 * everything characters say (dialogue). No dependency, no cleverness.
 *
 * Known limit: an all-caps action line such as "BANG." is read as a character
 * cue, and whatever follows it until the next blank line is treated as dialogue.
 * Covered in tests/fountain.test.ts and accepted.
 */
const SCENE = /^(INT|EXT|EST|I\/E)[\s./]/i;
const CUE = /^[A-Z0-9 .'()\-]+$/;
const MAX_CUE_LENGTH = 40;

export interface SplitScript {
  action: string[];
  dialogue: string[];
}

export function splitFountain(text: string): SplitScript {
  const action: string[] = [];
  const dialogue: string[] = [];
  let inDialogue = false;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) {
      inDialogue = false;
      continue;
    }
    if (SCENE.test(line)) {
      inDialogue = false;
      continue;
    }
    if (!inDialogue && CUE.test(line) && line.length < MAX_CUE_LENGTH) {
      inDialogue = true;
      continue;
    }
    if (inDialogue) {
      const parenthetical = line.startsWith('(') && line.endsWith(')');
      if (!parenthetical) dialogue.push(line);
      continue;
    }
    action.push(line);
  }

  return { action, dialogue };
}
