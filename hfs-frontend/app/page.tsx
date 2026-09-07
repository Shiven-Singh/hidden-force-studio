'use client';

import { useEffect, useState } from 'react';
import type { ArtBrief, CharacterBible, ReviewReport, RunManifest, Source, Stage } from '@hfs/schemas';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

type Bible = CharacterBible & { id: string };

interface RunView {
  status: 'running' | 'done' | 'error';
  error?: string;
  character: string;
  current: string | null;
  stages: readonly Stage[];
  events: Array<{ author: string; ts: number }>;
  sources?: Source[];
  review?: ReviewReport;
  review_history: ReviewReport[];
  art_brief?: ArtBrief;
  manifest?: RunManifest;
  package?: { folder: string; files: string[]; bucket: string | null };
}

const STAGE_LABEL: Record<Stage, string> = {
  intake: '1 · Intake',
  research: '2 · Research (Parallel)',
  rubric: '2 · Rubric (Gemini)',
  story: '3 · Story draft',
  gate: '4 · Gate',
  lock_character: '5 · Lock character',
  art_direction: '5 · Shot list',
  package: '6 · Package',
};

interface RunSummary {
  id: string;
  status: 'running' | 'done' | 'error';
  character: string;
  verdict?: string;
  started_at: number;
  live: boolean;
}

export default function Page() {
  const [bibles, setBibles] = useState<Bible[]>([]);
  const [recent, setRecent] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRecent = () =>
    fetch(`${API}/api/runs`).then((r) => r.json()).then((rs: RunSummary[]) => setRecent([...rs].reverse())).catch(() => undefined);

  useEffect(() => {
    fetch(`${API}/api/bibles`).then((r) => r.json()).then(setBibles).catch((e) => setError(String(e)));
    void loadRecent();
  }, []);

  useEffect(() => {
    if (run && run.status !== 'running') void loadRecent();
  }, [run?.status]);

  useEffect(() => {
    if (!runId) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`${API}/api/runs/${runId}`);
        const data = (await r.json()) as RunView;
        if (!stop) setRun(data);
        if (!stop && data.status === 'running') setTimeout(tick, 2000);
      } catch (e) {
        if (!stop) setError(String(e));
      }
    };
    void tick();
    return () => { stop = true; };
  }, [runId]);

  const start = async (bible: Bible) => {
    setError(null);
    setRun(null);
    const { id, ...body } = bible;
    void id;
    const r = await fetch(`${API}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { setError(`start failed: ${r.status}`); return; }
    const { run_id } = (await r.json()) as { run_id: string };
    setRunId(run_id);
  };

  const done = new Set(run?.events.map((e) => e.author) ?? []);

  return (
    <main className="shell">
      <h1>Hidden Force Studio</h1>
      <p className="lede">Pick a character bible. The pipeline researches live portrayal guidance, drafts an animated short, and refuses to ship a draft that fails the gate.</p>
      {error && <p className="error">{error}</p>}

      <h2>Bibles</h2>
      <div className="grid">
        {bibles.map((b) => (
          <button key={b.id} className={`card${b.adversarial ? ' adversarial' : ''}`} disabled={run?.status === 'running'} onClick={() => start(b)}>
            <div className="name">{b.name}{b.adversarial ? ' · adversarial' : ''}</div>
            <div className="meta">{b.age}, {b.trait}</div>
            <div className="meta">
              {b.adversarial
                ? b.adversarial_revisions === 'unguarded'
                  ? 'Every draft written without the rubric. Expect HALT after Pink.'
                  : 'First draft written without the rubric, to show the gate refusing.'
                : b.reframe}
            </div>
          </button>
        ))}
      </div>

      {recent.length > 0 && (
        <>
          <h2>Finished runs</h2>
          <p className="lede">Every run is written to storage, unedited. Open one to read the rubric, the gate's evidence, and the package.</p>
          <div className="grid">
            {recent.slice(0, 16).map((r) => (
              <button key={r.id} className="card" onClick={() => { setRun(null); setRunId(r.id); }}>
                <div className="name">
                  {r.character}{' '}
                  {r.verdict ? <span className={`chip ${r.verdict.toLowerCase()}`}>{r.verdict}</span> : <span className={`chip ${r.status}`}>{r.status}</span>}
                </div>
                <div className="meta mono">{r.id}</div>
                <div className="meta">{new Date(r.started_at).toLocaleString()}{r.live ? ' · this instance' : ''}</div>
              </button>
            ))}
          </div>
        </>
      )}

      {run && (
        <>
          <h2>Run · {run.character} <span className={`chip ${run.review?.verdict ? run.review.verdict.toLowerCase() : run.status}`}>{run.review?.verdict ?? run.status}</span></h2>
          {run.error && <p className="error">{run.error}</p>}
          <div className="timeline">
            {run.stages.map((s) => (
              <div key={s} className={`stage${done.has(s) && run.current !== s ? ' done' : ''}${run.current === s && run.status === 'running' ? ' current' : ''}`}>
                <span className="dot" />
                <span>{STAGE_LABEL[s]}</span>
                <span className="t mono">{done.has(s) ? 'done' : ''}</span>
              </div>
            ))}
          </div>

          {run.sources && (
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Citations from Parallel</h2>
              <div className="two">
                {(['advocacy', 'general'] as const).map((pool) => (
                  <div key={pool}>
                    <div className="chip">{pool}</div>
                    {run.sources!.filter((s) => s.pool === pool).map((s) => (
                      <div key={s.idx} className="src">
                        <div><a href={s.url} target="_blank" rel="noreferrer">[{s.idx}] {s.title}</a></div>
                        <div className="pub">{s.publisher}{s.publish_date ? ` · ${s.publish_date}` : ''}</div>
                        <div className="ex">{s.excerpt.slice(0, 200)}…</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {[...run.review_history].reverse().map((r) => (
            <div key={r.iteration} className="panel">
              <h2 style={{ marginTop: 0 }}>
                Gate · <span className={`chip ${r.revision_colour.toLowerCase()}`}>{r.revision_colour}</span>{' '}
                <span className={`chip ${r.verdict.toLowerCase()}`}>{r.verdict}</span>
              </h2>
              {[...r.deterministic, ...r.model_scored].map((s) => (
                <div key={s.rule_id} className="rule">
                  <span className="mono">{s.rule_id}</span>
                  <span className={`result-${s.result}`}>{s.result}</span>
                  <div>
                    {s.evidence && <blockquote>{s.evidence}</blockquote>}
                    <div className="note">{s.note}</div>
                  </div>
                </div>
              ))}
              {r.revision_instructions.length > 0 && (
                <>
                  <h2>Revision instructions</h2>
                  <ul>{r.revision_instructions.map((i, k) => <li key={k}>{i}</li>)}</ul>
                </>
              )}
            </div>
          ))}

          {run.art_brief && (
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Locked character</h2>
              <div className="locked">{run.art_brief.character.locked_description}</div>
              <div className="hash mono">sha256 {run.art_brief.consistency_hash}</div>
              <h2>Shot prompts (first four of {run.art_brief.shots.length})</h2>
              {run.art_brief.shots.slice(0, 4).map((s) => (
                <div key={s.number} className="shot">
                  <span className="mono">{s.number}.</span> <mark>{run.art_brief!.character.locked_description}</mark>
                  {s.prompt.slice(run.art_brief!.character.locked_description.length)}
                </div>
              ))}
            </div>
          )}

          {run.package && (
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Package</h2>
              <div className="mono muted">{run.package.folder}</div>
              <ul>
                {run.package.files.map((f) => (
                  <li key={f} className="mono">
                    <a href={`${API}/api/runs/${encodeURIComponent(run.package!.folder.split('/').pop() ?? '')}/files/${f}`} target="_blank" rel="noreferrer">{f}</a>
                  </li>
                ))}
              </ul>
              {run.manifest && <div className="muted">verdict {run.manifest.verdict} · {run.manifest.iterations} iteration(s) · ADK {run.manifest.adk_version}</div>}
            </div>
          )}
        </>
      )}
    </main>
  );
}
