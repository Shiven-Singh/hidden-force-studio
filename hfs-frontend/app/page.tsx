'use client';

import { useEffect, useState } from 'react';
import type { ArtBrief, CharacterBible, PortrayalRubric, ReviewReport, RunManifest, Source, Stage } from '@hfs/schemas';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

type Bible = CharacterBible & { id: string };

interface StoryboardFrame { shot: number; beat: number; file: string; prompt: string; error?: string }
interface RenderStatus { status: 'rendering' | 'done' | 'error'; clips?: number; done_clips?: number; error?: string; started_at?: string; finished_at?: string }

interface RunView {
  status: 'running' | 'done' | 'error';
  archived?: boolean;
  error?: string;
  character: string;
  current: string | null;
  folder?: string;
  stages: readonly Stage[];
  events: Array<{ author: string; ts: number }>;
  sources?: Source[];
  rubric?: PortrayalRubric;
  review?: ReviewReport;
  review_history: ReviewReport[];
  art_brief?: ArtBrief;
  storyboard?: { model: string; style: string; frames: StoryboardFrame[] };
  animatic?: string;
  render?: RenderStatus;
  manifest?: RunManifest;
  package?: { folder: string; files: string[]; bucket: string | null };
}

interface RunSummary {
  id: string;
  status: 'running' | 'done' | 'error';
  character: string;
  verdict?: string;
  started_at: number;
  live: boolean;
}

const STAGE_LABEL: Record<Stage, string> = {
  intake: '1 · Read the bible',
  research: '2 · Fetch guidance (Parallel)',
  rubric: '2 · Write the rules (Gemini)',
  story: '3 · Draft the script',
  gate: '4 · Review the draft',
  lock_character: '5 · Lock the character',
  art_direction: '5 · Shot list',
  storyboard: '5 · Storyboard',
  package: '6 · Package',
};

const fileUrl = (folder: string | undefined, file: string) => `${API}/api/runs/${encodeURIComponent(folder ?? '')}/files/${file}`;

export default function Page() {
  const [bibles, setBibles] = useState<Bible[]>([]);
  const [recent, setRecent] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  const loadRecent = () =>
    fetch(`${API}/api/runs`).then((r) => r.json()).then((rs: RunSummary[]) => setRecent([...rs].reverse())).catch(() => undefined);

  useEffect(() => {
    fetch(`${API}/api/bibles`).then((r) => r.json()).then(setBibles).catch((e) => setError(String(e)));
    void loadRecent();
    // Deep link: ?run=<id> opens a finished run directly.
    const wanted = new URLSearchParams(window.location.search).get('run');
    if (wanted && /^[a-z0-9_-]+$/i.test(wanted)) setRunId(wanted);
  }, []);

  useEffect(() => {
    if (!runId) return;
    const url = new URL(window.location.href);
    url.searchParams.set('run', runId);
    window.history.replaceState(null, '', url.toString());
  }, [runId]);

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
        const busy = data.status === 'running' || data.render?.status === 'rendering';
        if (!stop && busy) setTimeout(tick, 3000);
      } catch (e) {
        if (!stop) setError(String(e));
      }
    };
    void tick();
    return () => { stop = true; };
  }, [runId, rendering]);

  const start = async (bible: Bible) => {
    setError(null);
    setRun(null);
    const { id, ...body } = bible;
    void id;
    const r = await fetch(`${API}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { setError(`start failed: ${r.status}`); return; }
    const { run_id } = (await r.json()) as { run_id: string };
    setRunId(run_id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const render = async () => {
    if (!run?.folder) return;
    setRendering(true);
    const r = await fetch(`${API}/api/runs/${encodeURIComponent(run.folder)}/render`, { method: 'POST' });
    if (!r.ok) setError(`render failed to start: ${r.status}`);
    setRendering(false);
    setRunId(run.folder);
  };

  const done = new Set(run?.events.map((e) => e.author) ?? []);
  const frames = run?.storyboard?.frames.filter((f) => !f.error) ?? [];
  const verdict = run?.review?.verdict;

  return (
    <main className="shell">
      <h1>Hidden Force Studio</h1>
      <p className="lede">
        Give it a character bible for a neurodivergent or disabled child hero. It fetches current portrayal guidance, writes an animated short,
        and refuses to ship a draft that breaks the rules it found. What comes out: a storyboard, a screenplay, a locked character sheet,
        the review with its evidence, and, on request, a short film.
      </p>
      {error && <p className="error">{error}</p>}

      {run && (
        <section className="run">
          <h2>
            {run.character}
            {' '}
            <span className={`chip ${verdict ? verdict.toLowerCase() : run.status}`}>{verdict ?? run.status}</span>
            {run.archived && <span className="chip"> archived</span>}
          </h2>
          {run.error && <p className="error">{run.error}</p>}

          {run.status === 'running' && (
            <div className="timeline">
              {run.stages.map((s) => (
                <div key={s} className={`stage${done.has(s) && run.current !== s ? ' done' : ''}${run.current === s ? ' current' : ''}`}>
                  <span className="dot" />
                  <span>{STAGE_LABEL[s]}</span>
                  <span className="t mono">{done.has(s) && run.current !== s ? 'done' : run.current === s ? 'working' : ''}</span>
                </div>
              ))}
            </div>
          )}

          {run.animatic && (
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>The short</h2>
              <video className="film" controls preload="metadata" src={fileUrl(run.folder, run.animatic)} />
              <p className="muted small">Eight-second shots from Veo 3.1, one per key beat, cut together. Sound is Veo&apos;s own.</p>
            </div>
          )}
          {!run.animatic && run.render?.status === 'rendering' && (
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Rendering the short</h2>
              <p className="muted">{run.render.done_clips ?? 0} of {run.render.clips ?? '?'} shots done. A shot takes about a minute.</p>
            </div>
          )}
          {!run.animatic && run.render?.status === 'error' && <p className="error">Render failed: {run.render.error}</p>}

          {frames.length > 0 && (
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Storyboard</h2>
              <div className="board">
                {frames.map((f) => (
                  <figure key={f.shot}>
                    <img src={fileUrl(run.folder, f.file)} alt={`Shot ${f.shot}`} loading="lazy" />
                    <figcaption className="mono">shot {f.shot} · beat {f.beat}</figcaption>
                  </figure>
                ))}
              </div>
              <p className="muted small">Every frame starts from the same locked description of the character, so the design holds across shots.</p>
              {verdict === 'PASS' && !run.animatic && run.render?.status !== 'rendering' && run.status !== 'running' && (
                <button className="btn" onClick={render} disabled={rendering}>Render the short with Veo (about five minutes)</button>
              )}
            </div>
          )}

          {run.manifest && run.art_brief && (
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Script</h2>
              <p>
                <a href={fileUrl(run.folder, 'screenplay.fountain')} target="_blank" rel="noreferrer">screenplay.fountain</a>
                {' · '}
                <a href={fileUrl(run.folder, 'beat_sheet.md')} target="_blank" rel="noreferrer">beat_sheet.md</a>
                {' · '}
                <a href={fileUrl(run.folder, 'one_sheet.md')} target="_blank" rel="noreferrer">one_sheet.md</a>
              </p>
            </div>
          )}

          {[...run.review_history].reverse().map((r) => (
            <div key={r.iteration} className="panel">
              <h2 style={{ marginTop: 0 }}>
                Review · <span className={`chip ${r.revision_colour.toLowerCase()}`}>{r.revision_colour} draft</span>{' '}
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
                  <h3>Sent back to the writer</h3>
                  <ul>{r.revision_instructions.map((i, k) => <li key={k}>{i}</li>)}</ul>
                </>
              )}
            </div>
          ))}

          {run.rubric && (
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>The rules, and where they came from</h2>
              <div className="two">
                <div>
                  <div className="chip">must do</div>
                  {run.rubric.must_do.map((x) => <div key={x.id} className="src"><span className="mono">{x.id}</span> {x.rule} <span className="pub">[{x.source_ref}]</span></div>)}
                </div>
                <div>
                  <div className="chip">must not do</div>
                  {run.rubric.must_not_do.map((x) => <div key={x.id} className="src"><span className="mono">{x.id}</span> {x.rule} <span className="pub">[{x.source_ref}]</span></div>)}
                </div>
              </div>
              {run.sources && (
                <>
                  <h3>Sources, fetched live by Parallel</h3>
                  <div className="two">
                    {(['advocacy', 'general'] as const).map((pool) => (
                      <div key={pool}>
                        <div className="chip">{pool}</div>
                        {run.sources!.filter((s) => s.pool === pool).map((s) => (
                          <div key={s.idx} className="src">
                            <div><a href={s.url} target="_blank" rel="noreferrer">[{s.idx}] {s.title}</a></div>
                            <div className="pub">{s.publisher}{s.publish_date ? ` · ${s.publish_date}` : ''}</div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {run.art_brief && (
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Locked character</h2>
              <div className="locked">{run.art_brief.character.locked_description}</div>
              <div className="hash mono">sha256 {run.art_brief.consistency_hash}</div>
              <p className="muted small">This paragraph is pasted, unchanged, at the front of all {run.art_brief.shots.length} shot prompts and every storyboard frame.</p>
            </div>
          )}

          {run.package && (
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Files</h2>
              <ul className="files">
                {run.package.files.map((f) => (
                  <li key={f} className="mono"><a href={fileUrl(run.folder, f)} target="_blank" rel="noreferrer">{f}</a></li>
                ))}
              </ul>
              {run.manifest && <div className="muted small">verdict {run.manifest.verdict} · {run.manifest.iterations} draft(s) · draft model {run.manifest.models.draft} · review model {run.manifest.models.review} · ADK {run.manifest.adk_version}</div>}
            </div>
          )}
        </section>
      )}

      <h2>Start a run</h2>
      <p className="muted">Pick a character. A run takes two to four minutes and you can watch each stage.</p>
      <div className="grid">
        {bibles.map((b) => (
          <button key={b.id} className={`card${b.adversarial ? ' adversarial' : ''}`} disabled={run?.status === 'running'} onClick={() => start(b)}>
            <div className="name">{b.name}{b.adversarial ? ' · adversarial' : ''}</div>
            <div className="meta">{b.age}, {b.trait}</div>
            <div className="meta">
              {b.adversarial
                ? b.adversarial_revisions === 'unguarded'
                  ? 'Every draft written without the rules. Expect a refusal after three drafts.'
                  : 'First draft written without the rules, to show the review catching it.'
                : b.reframe}
            </div>
          </button>
        ))}
      </div>

      {recent.length > 0 && (
        <>
          <h2>Finished runs</h2>
          <p className="muted">Real runs, unedited. Open one to see the storyboard, the script, and the review.</p>
          <div className="grid">
            {recent.slice(0, 16).map((r) => (
              <button key={r.id} className="card" onClick={() => { setRun(null); setRunId(r.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
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
    </main>
  );
}
