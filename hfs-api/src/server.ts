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
import { InMemorySessionService, Runner } from '@google/adk';
import { CharacterBible, STAGES } from '@hfs/schemas';
import { rootAgent } from './agent.js';

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
    for await (const ev of runner.runAsync({
      userId: USER_ID,
      sessionId: runId,
      newMessage: { role: 'user', parts: [{ text: 'run' }] },
    })) {
      if (ev.author) {
        run.current = ev.author;
        run.events.push({ author: ev.author, ts: Date.now() });
      }
      const delta = ev.actions?.stateDelta;
      if (delta) Object.assign(run.state, delta);
    }
    run.status = 'done';
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

app.get('/api/runs', (_req, res) => {
  res.json([...RUNS.entries()].map(([id, r]) => ({ id, status: r.status, character: r.character, started_at: r.startedAt })));
});

app.get('/api/runs/:id', (req, res) => {
  const run = RUNS.get(req.params.id as string);
  if (!run) {
    res.status(404).json({ error: 'no such run' });
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
