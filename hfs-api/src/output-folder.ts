/**
 * Where a run's files live. One folder per run, named at intake so every later
 * stage (storyboard, package, render) writes to the same place, locally under
 * outputs/ and in the bucket when OUTPUT_BUCKET is set.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CharacterBible } from '@hfs/schemas';

/** Repo root, independent of the process cwd: hfs-api/src -> ../.. (same depth from dist/). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Read at call time, not import time, so tests can point it at a temp dir. */
export const outputDir = (): string => process.env.OUTPUT_DIR ?? path.join(REPO_ROOT, 'outputs');

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const stamp = (): string => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');

export function outputFolderName(bible: CharacterBible): string {
  const mode = bible.adversarial ? (bible.adversarial_revisions === 'unguarded' ? '_adversarial_unguarded' : '_adversarial') : '';
  return `${slug(bible.name)}${mode}_${stamp()}`;
}

export const localRunDir = (folder: string): string => path.join(outputDir(), folder);
