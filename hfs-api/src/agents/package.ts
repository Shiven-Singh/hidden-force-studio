import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createEvent, type InvocationContext, type Event } from '@google/adk';
import { PipelineAgent } from './base.js';
import {
  CharacterBible,
  PortrayalRubric,
  RunManifest,
  type ArtBrief,
  type ReviewReport,
  type Screenplay,
} from '@hfs/schemas';
import { DRAFT_MODEL, REVIEW_MODEL } from '../clients/gemini.js';
import { saveRunFile } from '../clients/media.js';
import { localRunDir } from '../output-folder.js';
import type { Storyboard } from '../clients/media.js';

const require = createRequire(import.meta.url);

async function adkVersion(): Promise<string> {
  try {
    const entry = require.resolve('@google/adk');
    const root = entry.slice(0, entry.lastIndexOf(`${path.sep}dist${path.sep}`));
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

/**
 * Stage 6. Always writes a folder, even on HALT, because the committed HALT
 * run is part of the demo. A passing run gets the script package plus the
 * storyboard; a halted run gets the rubric, the review history, the rejected
 * draft, and a manifest.
 */
export class PackageAgent extends PipelineAgent {
  constructor() {
    super({ name: 'package', description: 'Writes the output folder and the run manifest.' });
  }

  protected async *runAsyncImpl(ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    const st = ctx.session.state;
    const bible = this.read(ctx, 'bible', CharacterBible, 'intake');
    const rubric = this.read(ctx, 'rubric', PortrayalRubric, 'rubric');
    const history = (st['review_history'] as ReviewReport[] | undefined) ?? [];
    const review = st['review'] as ReviewReport | undefined;
    const verdict = review?.verdict ?? 'HALT';
    const passed = verdict === 'PASS';
    const screenplay = st['screenplay'] as Screenplay | undefined;
    const brief = st['art_brief'] as ArtBrief | undefined;

    const runId = String(st['run_id'] ?? 'unknown');
    const folder = String(st['output_folder']);
    const outDir = localRunDir(folder);
    const storyboard = st['storyboard'] as Storyboard | undefined;

    const files: Record<string, string> = {
      'portrayal_rubric.json': JSON.stringify(rubric, null, 2),
      'review_history.json': JSON.stringify(history, null, 2),
    };

    if (screenplay) {
      files[passed ? 'screenplay.fountain' : 'screenplay.rejected.fountain'] = screenplay.fountain;
      files['beat_sheet.md'] =
        `# ${screenplay.title}\n\n**Logline.** ${screenplay.logline}\n\n**Trait causality.** ${screenplay.trait_causality_note}\n\n` +
        screenplay.beats.map((b) => `## ${b.number}. ${b.title}\n\n${b.summary}\n\n*Trait in play:* ${b.trait_in_play}\n`).join('\n');
    }
    if (passed && brief && screenplay) {
      files['art_brief.json'] = JSON.stringify(brief, null, 2);
      files['one_sheet.md'] =
        `# ${screenplay.title}\n\n${screenplay.logline}\n\n## Character\n\n${bible.name}, ${bible.age}, ${bible.trait}. ${bible.reframe}.\n\n` +
        `## Why this story\n\n${screenplay.trait_causality_note}\n\n## Format\n\nAnimated short, ~${screenplay.page_estimate} minutes, ages 6 to 9.\n`;
    }

    const manifest = RunManifest.parse({
      run_id: runId,
      character: bible.name,
      started_at: String(st['started_at'] ?? new Date().toISOString()),
      finished_at: new Date().toISOString(),
      verdict,
      iterations: history.length,
      models: { draft: DRAFT_MODEL, review: REVIEW_MODEL, rubric: REVIEW_MODEL, lock: REVIEW_MODEL },
      adk_version: await adkVersion(),
      parallel_search_ids: (st['parallel_search_ids'] as string[] | undefined) ?? [],
      source_urls: rubric.sources.map((s) => s.url),
      stage_timings_ms: (st['stage_timings_ms'] as Record<string, number> | undefined) ?? {},
    });
    files['run_manifest.json'] = JSON.stringify(manifest, null, 2);
    // storyboard.json is written by drawStoryboard itself; listed here so the package knows about it.

    await Promise.all(
      Object.entries(files).map(([name, body]) =>
        saveRunFile(folder, name, body, name.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8')),
    );

    const frameFiles = storyboard?.frames.filter((f) => !f.error).map((f) => f.file) ?? [];
    const listed = [...Object.keys(files), ...(storyboard ? ['storyboard.json'] : [])].sort();
    const delta: Record<string, unknown> = {
      manifest,
      package: { folder, local_dir: outDir, files: [...listed, ...frameFiles], bucket: process.env.OUTPUT_BUCKET ?? null },
    };
    Object.assign(st, delta);
    yield createEvent({ author: this.name, actions: { stateDelta: delta } });
  }
}
