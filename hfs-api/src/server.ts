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
import { CharacterBible, STAGES, type RunManifest } from '@hfs/schemas';
import { rootAgent } from './agent.js';
import { RUN_INACTIVITY_MS } from './clients/http.js';

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
const FILE_NAME = /^[a-z_]+(\.[a-z]+)*\.(json|md|fountain)$/i;
const storage = BUCKET ? new Storage() : undefined;

async function readArchivedFile(id: string, name: string): Promise<string | undefined> {
  if (!RUN_ID.test(id) || !FILE_NAME.test(name)) return undefined;
  try {
    if (storage && BUCKET) {
      const [buf] = await storage.bucket(BUCKET).file(`${id}/${name}`).download();
      return buf.toString('utf8');
    }
    return await readFile(path.join(OUTPUT_DIR, id, name), 'utf8');
  } catch {
    return undefined;
  }
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
      const [id, name] = f.name.split('/');
      if (id && name && RUN_ID.test(id)) folders.set(id, [...(folders.get(id) ?? []), name]);
    }
  } else {
    for (const id of await readdir(OUTPUT_DIR).catch(() => [] as string[])) {
      if (RUN_ID.test(id)) folders.set(id, await readdir(path.join(OUTPUT_DIR, id)).catch(() => [] as string[]));
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
  return {
    status: 'done',
    archived: true,
    character: summary.character,
    current: null,
    stages: STAGES,
    events: STAGES.map((s) => ({ author: s, ts: summary.started_at })),
    sources: rubric?.sources,
    rubric,
    review: history.at(-1),
    review_history: history,
    art_brief: artBrief,
    manifest,
    package: { folder: id, files: summary.files, bucket: BUCKET ?? null },
  };
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
  }
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

app.get('/api/runs/:id/files/:name', async (req, res) => {
  const body = await readArchivedFile(req.params.id as string, req.params.name as string);
  if (body === undefined) {
    res.status(404).json({ error: 'no such file' });
    return;
  }
  res.type((req.params.name as string).endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8').send(body);
});

app.get('/api/runs/:id', async (req, res) => {
  const run = RUNS.get(req.params.id as string);
  if (!run) {
    const view = await archivedView(req.params.id as string);
    if (view) res.json(view);
    else res.status(404).json({ error: 'no such run' });
    return;
  }
  const s = run.state;
  res.json({
    status: run.status,
    error: run.error,
    character: run.character,
    current: run.current,
    stages: STAGES,
    events: run.events,
    sources: s['sources'],
    rubric: s['rubric'],
    review: s['review'],
    review_history: s['review_history'] ?? [],
    art_brief: s['art_brief'],
    manifest: s['manifest'],
    package: s['package'],
  });
});

app.use(express.static(STATIC_DIR));

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`hfs-api listening on :${port}, static from ${STATIC_DIR}`);
});
