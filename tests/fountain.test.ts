import { describe, expect, it } from 'vitest';
import { splitFountain } from '../hfs-api/src/gate/fountain.js';

const SCRIPT = `INT. CLASSROOM - DAY

Zayan drums both thumbs on the desk. Every poster on the wall is a door he has not opened yet.

MS. RAO
Zayan. Eyes on the board.

ZAYAN
(quietly)
They are on the board. And the window. And the clock.

She says he is confined to a wheelchair of his own making.

BANG.
The maze door slams.

EXT. PLAYGROUND - CONTINUOUS

Zayan runs.`;

describe('splitFountain', () => {
  const { action, dialogue } = splitFountain(SCRIPT);

  it('drops scene headings', () => {
    expect(action.some((l) => l.startsWith('INT.'))).toBe(false);
    expect(action.some((l) => l.startsWith('EXT.'))).toBe(false);
  });

  it('keeps narration as action', () => {
    expect(action).toContain('Zayan drums both thumbs on the desk. Every poster on the wall is a door he has not opened yet.');
    expect(action).toContain('Zayan runs.');
  });

  it('routes spoken lines to dialogue, skipping parentheticals', () => {
    expect(dialogue).toContain('Zayan. Eyes on the board.');
    expect(dialogue).toContain('They are on the board. And the window. And the clock.');
    expect(dialogue).not.toContain('(quietly)');
  });

  it('treats a line of narration between dialogue blocks as action', () => {
    expect(action).toContain('She says he is confined to a wheelchair of his own making.');
  });

  it('documents the all-caps action limitation', () => {
    // "BANG." reads as a character cue, so the line after it becomes dialogue.
    expect(dialogue).toContain('The maze door slams.');
  });
});
