/**
 * Express owns each run as a background job and serves the Next.js static
 * export. The browser polls. One Cloud Run service, one URL.
 */
import './env.js';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response } from 'express';
import { InMemorySessionService, Runner, type Event } from '@google/adk';
import { Storage } from '@google-cloud/storage';
import { ArtBrief, CharacterBible, STAGES, type RunManifest } from '@hfs/schemas';
import { rootAgent } from './agent.js';
import { RUN_INACTIVITY_MS } from './clients/http.js';
import { CLIP_MODEL, CLIP_SECONDS, STYLE, concatClips, drawStoryboard, generateClip, mapLimit, readRunFile, saveRunFile, type Storyboard } from './clients/media.js';
import { localRunDir } from './output-folder.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const BIBLES_DIR = process.env.BIBLES_DIR ?? path.join(REPO_ROOT, 'bibles');
const STATIC_DIR = process.env.STATIC_DIR ?? path.join(REPO_ROOT, 'hfs-frontend', 'out');
const APP_NAME = 'hfs';
const USER_ID = 'studio';

interface Run {
  status: 'running' | 'done' | 'error';
  character: string;
  startedAt: number;
  current: string | null;
  events: Array<{ author: string; ts: number }>;
  state: Record<string, unknown>;
  error?: string;
}

/**
 * Archived runs: every finished run is a folder of files, in the bucket when
 * OUTPUT_BUCKET is set and under outputs/ otherwise. Listing them means the UI
 * shows the committed runs on a cold instance, not just what this process ran.
 */
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? path.join(REPO_ROOT, 'outputs');
const BUCKET = process.env.OUTPUT_BUCKET;
const RUN_ID = /^[a-z0-9_]+$/i;
/** Top-level package files, or one level down: storyboard/shot_01.jpg, animatic/animatic.mp4. */
const FILE_NAME = /^(?:(?:storyboard|animatic)\/)?[a-z_0-9]+(\.[a-z]+)*\.(json|md|fountain|jpg|png|mp4)$/i;
const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json', md: 'text/markdown; charset=utf-8', fountain: 'text/plain; charset=utf-8',
  jpg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4',
};
const storage = BUCKET ? new Storage() : undefined;

async function readArchivedBytes(id: string, name: string): Promise<Buffer | undefined> {
  if (!RUN_ID.test(id) || !FILE_NAME.test(name)) return undefined;
  try {
    if (storage && BUCKET) {
      const [buf] = await storage.bucket(BUCKET).file(`${id}/${name}`).download();
      return buf;
    }
    return await readFile(path.join(OUTPUT_DIR, id, name));
  } catch {
    return undefined;
  }
}

async function readArchivedFile(id: string, name: string): Promise<string | undefined> {
  const buf = await readArchivedBytes(id, name);
  return buf?.toString('utf8');
}

/** Files under a run folder, including subfolders, as relative paths. */
async function listRunFiles(id: string): Promise<string[]> {
  if (storage && BUCKET) {
    const [files] = await storage.bucket(BUCKET).getFiles({ prefix: `${id}/` });
    return files.map((f) => f.name.slice(id.length + 1)).filter(Boolean).sort();
  }
  const out: string[] = [];
  const walk = async (dir: string, rel: string) => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else out.push(r);
    }
  };
  await walk(path.join(OUTPUT_DIR, id), '');
  return out.sort();
}

interface ArchivedSummary {
  id: string;
  status: 'done';
  character: string;
  verdict: string;
  started_at: number;
  files: string[];
}

let archiveCache: { at: number; runs: ArchivedSummary[] } | undefined;

async function listArchived(): Promise<ArchivedSummary[]> {
  if (archiveCache && Date.now() - archiveCache.at < 60_000) return archiveCache.runs;
  const folders = new Map<string, string[]>();
  if (storage && BUCKET) {
    const [files] = await storage.bucket(BUCKET).getFiles();
    for (const f of files) {
      const idx = f.name.indexOf('/');
      if (idx < 1) continue;
      const id = f.name.slice(0, idx);
      const name = f.name.slice(idx + 1);
      if (name && RUN_ID.test(id) && !id.startsWith('_')) folders.set(id, [...(folders.get(id) ?? []), name]);
    }
  } else {
    for (const id of await readdir(OUTPUT_DIR).catch(() => [] as string[])) {
      if (RUN_ID.test(id)) folders.set(id, await listRunFiles(id));
    }
  }
  const runs: ArchivedSummary[] = [];
  for (const [id, files] of folders) {
    const raw = await readArchivedFile(id, 'run_manifest.json');
    if (!raw) continue;
    const m = JSON.parse(raw) as RunManifest;
    runs.push({ id, status: 'done', character: m.character, verdict: m.verdict, started_at: Date.parse(m.started_at), files: files.sort() });
  }
  runs.sort((a, b) => a.started_at - b.started_at);
  archiveCache = { at: Date.now(), runs };
  return runs;
}

async function archivedView(id: string) {
  const runs = await listArchived();
  const summary = runs.find((r) => r.id === id);
  if (!summary) return undefined;
  const json = async (name: string) => { const raw = await readArchivedFile(id, name); return raw ? JSON.parse(raw) : undefined; };
  const rubric = await json('portrayal_rubric.json');
  const history = ((await json('review_history.json')) ?? []) as unknown[];
  const manifest = await json('run_manifest.json');
  const artBrief = await json('art_brief.json');
  const storyboard = await json('storyboard.json');
  const render = await json('animatic/render.json');
  return {
    status: 'done',
    archived: true,
    character: summary.character,
    current: null,
    folder: id,
    stages: STAGES,
    events: STAGES.map((s) => ({ author: s, ts: summary.started_at })),
    sources: rubric?.sources,
    rubric,
    review: history.at(-1),
    review_history: history,
    art_brief: artBrief,
    storyboard,
    animatic: summary.files.includes('animatic/animatic.mp4') ? 'animatic/animatic.mp4' : undefined,
    render,
    manifest,
    package: { folder: id, files: summary.files, bucket: BUCKET ?? null },
  };
}

/**
 * The short: up to RENDER_SHOTS eight-second Veo clips, one per evenly spaced
 * shot, cut together. On demand, because it costs real money per run. Progress
 * lives in animatic/render.json next to the clips so it survives restarts.
 */
const RENDER_SHOTS = Number(process.env.RENDER_SHOTS ?? 8);
/** Each film is eight Veo clips on a real bill. Cap how many this instance will start. */
const RENDER_LIMIT = Number(process.env.RENDER_LIMIT ?? 3);
let rendersStarted = 0;
const RENDERING = new Set<string>();

async function renderAnimatic(folder: string): Promise<void> {
  const progress = (status: Record<string, unknown>) =>
    saveRunFile(folder, 'animatic/render.json', JSON.stringify(status, null, 2), 'application/json');
  const briefRaw = await readRunFile(folder, 'art_brief.json');
  if (!briefRaw) throw new Error('no art brief; only a passing run can be rendered');
  const brief = ArtBrief.parse(JSON.parse(briefRaw.toString('utf8')));
  const n = Math.min(RENDER_SHOTS, brief.shots.length);
  const picks = Array.from({ length: n }, (_, i) => brief.shots[Math.floor((i * brief.shots.length) / n)]!);
  const startedAt = new Date().toISOString();
  let doneClips = 0;
  await progress({ status: 'rendering', clips: n, done_clips: 0, started_at: startedAt, model: CLIP_MODEL, seconds_per_clip: CLIP_SECONDS });

  const clipFiles = await mapLimit(picks, 2, async (shot, i) => {
    const prompt = `${STYLE} ${shot.prompt} Gentle camera movement. Ambient sound only, no dialogue, no narration, no lyrics.`;
    const bytes = await generateClip(prompt);
    const rel = `animatic/clip_${String(i + 1).padStart(2, '0')}.mp4`;
    const local = await saveRunFile(folder, rel, bytes, 'video/mp4');
    doneClips += 1;
    await progress({ status: 'rendering', clips: n, done_clips: doneClips, started_at: startedAt, model: CLIP_MODEL, seconds_per_clip: CLIP_SECONDS });
    return local;
  });

  const out = path.join(localRunDir(folder), 'animatic', 'animatic.mp4');
  await concatClips(clipFiles, out);
  await saveRunFile(folder, 'animatic/animatic.mp4', await readFile(out), 'video/mp4');
  await progress({
    status: 'done', clips: n, done_clips: n, started_at: startedAt, finished_at: new Date().toISOString(),
    model: CLIP_MODEL, seconds_per_clip: CLIP_SECONDS, shots: picks.map((s) => s.number),
  });
  archiveCache = undefined;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

if (process.env.NODE_ENV !== 'production') {
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    next();
  });
}

const sessions = new InMemorySessionService();
const runner = new Runner({ appName: APP_NAME, agent: rootAgent, sessionService: sessions });
const RUNS = new Map<string, Run>();

/**
 * A snapshot of a live run's status in the bucket, so a poll that lands after
 * a restart (or on another instance) can still answer instead of 404ing.
 */
async function snapshot(runId: string, run: Run): Promise<void> {
  if (!storage || !BUCKET) return;
  const body = JSON.stringify({
    run_id: runId, status: run.status, current: run.current, character: run.character,
    started_at: run.startedAt, folder: run.state['output_folder'] ?? null, error: run.error ?? null,
    events: run.events, updated_at: Date.now(),
  });
  await storage.bucket(BUCKET).file(`_runs/${runId}.json`).save(body, { contentType: 'application/json' }).catch(() => undefined);
}

async function readSnapshot(runId: string): Promise<Record<string, unknown> | undefined> {
  if (!storage || !BUCKET || !/^[a-z0-9-]+$/i.test(runId)) return undefined;
  try {
    const [buf] = await storage.bucket(BUCKET).file(`_runs/${runId}.json`).download();
    return JSON.parse(buf.toString('utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function execute(runId: string, bible: CharacterBible): Promise<void> {
  const run = RUNS.get(runId)!;
  try {
    await sessions.createSession({
      appName: APP_NAME,
      userId: USER_ID,
      sessionId: runId,
      state: { bible_raw: bible, run_id: runId },
    });
    const events = runner.runAsync({
      userId: USER_ID,
      sessionId: runId,
      newMessage: { role: 'user', parts: [{ text: 'run' }] },
    })[Symbol.asyncIterator]();
    for (;;) {
      // Watchdog: a pipeline that emits nothing for RUN_INACTIVITY_MS is dead, not slow.
      let timer: NodeJS.Timeout | undefined;
      const inactivity = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no progress for ${RUN_INACTIVITY_MS / 60000} minutes at stage ${run.current ?? 'start'}`)), RUN_INACTIVITY_MS);
      });
      let step: IteratorResult<Event, void>;
      try {
        step = await Promise.race([events.next(), inactivity]);
      } catch (err) {
        void events.return?.(undefined);
        throw err;
      } finally {
        clearTimeout(timer);
      }
      if (step.done) break;
      const ev: Event = step.value;
      if (ev.author) {
        run.current = ev.author;
        run.events.push({ author: ev.author, ts: Date.now() });
      }
      const delta = ev.actions?.stateDelta;
      if (delta) Object.assign(run.state, delta);
      void snapshot(runId, run);
      // A failed model call arrives as an event, not an exception, and ADK moves on
      // to the next stage with nothing in state. Stop here and say what happened.
      if (ev.errorCode || ev.errorMessage) {
        throw new Error(`${ev.author ?? 'model'} failed: ${ev.errorCode ?? ''} ${ev.errorMessage ?? ''}`.trim());
      }
    }
    run.status = 'done';
    archiveCache = undefined; // the new folder should show up on the next listing
  } catch (err) {
    run.status = 'error';
    run.error = err instanceof Error ? err.message : String(err);
    console.error(`run ${runId} failed at ${run.current ?? 'start'}: ${run.error}`);
  }
  await snapshot(runId, run);
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/bibles', async (_req, res) => {
  const names = (await readdir(BIBLES_DIR)).filter((f) => f.endsWith('.json')).sort();
  const bibles = await Promise.all(
    names.map(async (f) => ({ id: f.replace(/\.json$/, ''), ...CharacterBible.parse(JSON.parse(await readFile(path.join(BIBLES_DIR, f), 'utf8'))) })),
  );
  res.json(bibles);
});

app.post('/api/runs', (req: Request, res: Response) => {
  const parsed = CharacterBible.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const runId = randomUUID().slice(0, 12);
  RUNS.set(runId, { status: 'running', character: parsed.data.name, startedAt: Date.now(), current: null, events: [], state: {} });
  void execute(runId, parsed.data);
  res.status(202).json({ run_id: runId });
});

app.get('/api/runs', async (_req, res) => {
  const live = [...RUNS.entries()].map(([id, r]) => ({ id, status: r.status, character: r.character, started_at: r.startedAt, live: true }));
  const archived = (await listArchived()).map((r) => ({ id: r.id, status: r.status, character: r.character, verdict: r.verdict, started_at: r.started_at, live: false }));
  res.json([...archived, ...live]);
});

/** Redraw the frames a finished run's storyboard is missing. Idempotent; sequential; safe to call twice. */
const REDRAWING = new Set<string>();
app.post('/api/runs/:id/storyboard', async (req, res) => {
  const id = req.params.id as string;
  if (!RUN_ID.test(id) || id.startsWith('_')) {
    res.status(404).json({ error: 'no such run' });
    return;
  }
  const briefRaw = await readRunFile(id, 'art_brief.json');
  if (!briefRaw) {
    res.status(400).json({ error: 'only a passing run has an art brief to draw from' });
    return;
  }
  if (REDRAWING.has(id)) {
    res.status(202).json({ status: 'drawing' });
    return;
  }
  const brief = ArtBrief.parse(JSON.parse(briefRaw.toString('utf8')));
  const existingRaw = await readRunFile(id, 'storyboard.json');
  const existing = existingRaw ? (JSON.parse(existingRaw.toString('utf8')) as Storyboard) : undefined;
  const missing = brief.shots.filter((s) => !existing?.frames.some((f) => f.shot === s.number && !f.error)).length;
  if (missing === 0) {
    res.json({ status: 'done', frames: brief.shots.length });
    return;
  }
  REDRAWING.add(id);
  drawStoryboard(id, brief.shots, brief.shots[0]?.palette ?? [], existing)
    .catch((err) => console.error(`storyboard ${id} failed: ${err instanceof Error ? err.message : String(err)}`))
    .finally(() => {
      REDRAWING.delete(id);
      archiveCache = undefined;
    });
  res.status(202).json({ status: 'drawing', missing });
});

app.post('/api/runs/:id/render', async (req, res) => {
  const id = req.params.id as string;
  if (!RUN_ID.test(id)) {
    res.status(404).json({ error: 'no such run' });
    return;
  }
  const files = await listRunFiles(id);
  if (!files.includes('art_brief.json')) {
    res.status(400).json({ error: 'only a passing run has an art brief to render from' });
    return;
  }
  if (files.includes('animatic/animatic.mp4')) {
    res.json({ status: 'done' });
    return;
  }
  if (RENDERING.has(id)) {
    res.status(202).json({ status: 'rendering' });
    return;
  }
  if (rendersStarted >= RENDER_LIMIT) {
    res.status(429).json({ error: `the render budget is used up for now (${RENDER_LIMIT} films per instance); the two finished films are on the Zayan and adversarial Maya runs` });
    return;
  }
  rendersStarted += 1;
  RENDERING.add(id);
  renderAnimatic(id)
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`render ${id} failed: ${message}`);
      await saveRunFile(id, 'animatic/render.json', JSON.stringify({ status: 'error', error: message.slice(0, 300) }, null, 2), 'application/json').catch(() => undefined);
    })
    .finally(() => {
      RENDERING.delete(id);
      archiveCache = undefined;
    });
  res.status(202).json({ status: 'rendering' });
});

app.get(['/api/runs/:id/files/:name', '/api/runs/:id/files/:dir/:name'], async (req, res) => {
  const rel = [req.params.dir, req.params.name].filter(Boolean).join('/');
  const id = req.params.id as string;
  if (!RUN_ID.test(id) || !FILE_NAME.test(rel)) {
    res.status(404).json({ error: 'no such file' });
    return;
  }
  const ext = rel.split('.').pop()!.toLowerCase();
  res.type(CONTENT_TYPES[ext] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  if (storage && BUCKET) {
    // Stream, so a film is not held in memory and Cloud Run's buffered-response cap does not apply.
    const file = storage.bucket(BUCKET).file(`${id}/${rel}`);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).json({ error: 'no such file' });
      return;
    }
    file.createReadStream().on('error', () => res.destroy()).pipe(res);
    return;
  }
  const body = await readArchivedBytes(id, rel);
  if (body === undefined) res.status(404).json({ error: 'no such file' });
  else res.send(body);
});

app.get('/api/runs/:id', async (req, res) => {
  const id = req.params.id as string;
  const run = RUNS.get(id);
  if (!run) {
    const view = await archivedView(id);
    if (view) {
      res.json(view);
      return;
    }
    // Not in memory and not archived: maybe a live run from a previous instance.
    const snap = await readSnapshot(id);
    if (snap) {
      const folder = typeof snap['folder'] === 'string' ? (snap['folder'] as string) : undefined;
      const archived = folder ? await archivedView(folder) : undefined;
      if (archived) {
        res.json({ ...archived, status: snap['status'] === 'error' ? 'error' : archived.status, error: snap['error'] ?? undefined });
      } else {
        res.json({
          status: snap['status'] === 'running' ? 'error' : snap['status'],
          error: snap['error'] ?? (snap['status'] === 'running' ? 'the instance running this job restarted before it finished' : undefined),
          character: snap['character'], current: snap['current'], folder, stages: STAGES,
          events: snap['events'] ?? [], review_history: [],
        });
      }
      return;
    }
    res.status(404).json({ error: 'no such run' });
    return;
  }
  const s = run.state;
  res.json({
    status: run.status,
    error: run.error,
    character: run.character,
    current: run.current,
    folder: s['output_folder'],
    stages: STAGES,
    events: run.events,
    sources: s['sources'],
    rubric: s['rubric'],
    review: s['review'],
    review_history: s['review_history'] ?? [],
    art_brief: s['art_brief'],
    storyboard: s['storyboard'],
    manifest: s['manifest'],
    package: s['package'],
  });
});

app.use(express.static(STATIC_DIR));

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`hfs-api listening on :${port}, static from ${STATIC_DIR}`);
});
