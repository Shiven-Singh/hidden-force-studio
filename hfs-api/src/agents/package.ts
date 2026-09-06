import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createEvent, type InvocationContext, type Event } from '@google/adk';
import { PipelineAgent } from './base.js';
import { Storage } from '@google-cloud/storage';
import {
  CharacterBible,
  PortrayalRubric,
  RunManifest,
  type ArtBrief,
  type ReviewReport,
  type Screenplay,
} from '@hfs/schemas';
import { DRAFT_MODEL, REVIEW_MODEL } from '../clients/gemini.js';

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

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const stamp = (): string => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', 'T');

/**
 * Stage 6. Always writes a folder, even on HALT, because the committed HALT
 * run is part of the demo. A passing run gets seven files; a halted run gets
 * the rubric, the review history, the rejected draft, and a manifest.
 */
export class PackageAgent extends PipelineAgent {
  constructor() {
    super({ name: 'package', description: 'Writes the output folder and the run manifest.' });
  }

  protected async *runAsyncImpl(ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    const st = ctx.session.state;
    const bible = CharacterBible.parse(st['bible']);
    const rubric = PortrayalRubric.parse(st['rubric']);
    const history = (st['review_history'] as ReviewReport[] | undefined) ?? [];
    const review = st['review'] as ReviewReport | undefined;
    const verdict = review?.verdict ?? 'HALT';
    const passed = verdict === 'PASS';
    const screenplay = st['screenplay'] as Screenplay | undefined;
    const brief = st['art_brief'] as ArtBrief | undefined;

    const runId = String(st['run_id'] ?? stamp());
    const folder = `${slug(bible.name)}${bible.adversarial ? '_adversarial' : ''}_${stamp()}`;
    const outDir = path.join(process.env.OUTPUT_DIR ?? 'outputs', folder);
    await mkdir(outDir, { recursive: true });

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

    await Promise.all(Object.entries(files).map(([name, body]) => writeFile(path.join(outDir, name), body, 'utf8')));

    const bucket = process.env.OUTPUT_BUCKET;
    if (bucket) {
      const storage = new Storage();
      await Promise.all(
        Object.entries(files).map(([name, body]) => storage.bucket(bucket).file(`${folder}/${name}`).save(body)),
      );
    }

    const delta: Record<string, unknown> = {
      manifest,
      package: { folder: outDir, files: Object.keys(files), bucket: bucket ?? null },
    };
    Object.assign(st, delta);
    yield createEvent({ author: this.name, actions: { stateDelta: delta } });
  }
}
