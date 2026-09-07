'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ArtBrief, CharacterBible, PortrayalRubric, ReviewReport, RunManifest, Source } from '@hfs/schemas';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

type Bible = CharacterBible & { id: string };

interface StoryboardFrame { shot: number; beat: number; file: string; prompt: string; error?: string }
interface RenderStatus { status: 'rendering' | 'done' | 'error'; clips?: number; done_clips?: number; error?: string; narration?: string[]; voice?: string }

interface RunView {
  status: 'running' | 'done' | 'error';
  archived?: boolean;
  error?: string;
  character: string;
  current: string | null;
  folder?: string;
  film?: boolean;
  film_skipped?: string;
  stages: readonly string[];
  events: Array<{ author: string; ts: number }>;
  sources?: Source[];
  rubric?: PortrayalRubric;
  review?: ReviewReport;
  review_history: ReviewReport[];
  art_brief?: ArtBrief;
  storyboard?: { frames: StoryboardFrame[] };
  storyboard_progress?: { done: number; total: number };
  animatic?: string;
  render?: RenderStatus;
  manifest?: RunManifest;
  package?: { folder: string; files: string[] };
}

interface RunSummary {
  id: string;
  status: 'running' | 'done' | 'error';
  character: string;
  verdict?: string;
  film?: boolean;
  started_at: number;
  live: boolean;
}

const fileUrl = (folder: string | undefined, file: string) => `${API}/api/runs/${encodeURIComponent(folder ?? '')}/files/${file}`;

interface Step { key: string; label: string; detail?: string }

function stepsFor(run: RunView): Step[] {
  const rules = run.rubric ? run.rubric.must_do.length + run.rubric.must_not_do.length : 0;
  const drafts = run.review_history.length;
  const last = run.review_history.at(-1);
  const sb = run.storyboard_progress ?? (run.storyboard ? { done: run.storyboard.frames.filter((f) => !f.error).length, total: run.storyboard.frames.length } : undefined);
  const r = run.render;
  const steps: Step[] = [
    { key: 'research', label: 'Fetch portrayal guidance', detail: run.sources ? `${run.sources.length} sources from Parallel` : undefined },
    { key: 'rubric', label: 'Write the rules', detail: rules ? `${rules} rules, each citing a source` : undefined },
    { key: 'story', label: 'Draft the script', detail: drafts ? `${drafts} draft${drafts > 1 ? 's' : ''}` : undefined },
    { key: 'gate', label: 'Review the draft', detail: last ? `${last.revision_colour}: ${last.verdict}${last.hard_failures.length ? ` on ${last.hard_failures.join(', ')}` : ''}` : undefined },
    { key: 'lock_character', label: 'Lock the character' },
    { key: 'storyboard', label: 'Draw the storyboard', detail: sb ? `${sb.done} of ${sb.total} frames` : undefined },
    { key: 'package', label: 'Package the files' },
  ];
  if (run.film) steps.push({ key: 'film', label: 'Make the film', detail: r ? (r.status === 'done' ? `${r.clips} shots, narrated` : r.status === 'error' ? `failed: ${r.error}` : `${r.done_clips ?? 0} of ${r.clips ?? 8} shots`) : run.film_skipped });
  return steps;
}

export default function Page() {
  const [bibles, setBibles] = useState<Bible[]>([]);
  const [recent, setRecent] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withFilm, setWithFilm] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadRecent = () =>
    fetch(`${API}/api/runs`).then((r) => r.json()).then((rs: RunSummary[]) => setRecent([...rs].reverse())).catch(() => undefined);

  useEffect(() => {
    fetch(`${API}/api/bibles`).then((r) => r.json()).then(setBibles).catch((e) => setError(String(e)));
    void loadRecent();
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
        const working = data.status === 'running' || data.render?.status === 'rendering';
        if (!stop && working) setTimeout(tick, 3000);
      } catch (e) {
        if (!stop) setTimeout(tick, 5000);
        void e;
      }
    };
    void tick();
    return () => { stop = true; };
  }, [runId]);

  const start = async (bible: Bible) => {
    setError(null);
    setRun(null);
    setBusy(true);
    const { id, ...body } = bible;
    void id;
    const r = await fetch(`${API}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, film: withFilm }) });
    setBusy(false);
    if (!r.ok) { setError(`could not start: ${r.status}`); return; }
    const { run_id } = (await r.json()) as { run_id: string };
    setRunId(run_id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const makeFilm = async () => {
    if (!run?.folder) return;
    setBusy(true);
    const r = await fetch(`${API}/api/runs/${encodeURIComponent(run.folder)}/render`, { method: 'POST' });
    setBusy(false);
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `could not start the film: ${r.status}`);
      return;
    }
    setRun(null);
    setRunId(run.folder);
  };

  const steps = useMemo(() => (run ? stepsFor(run) : []), [run]);
  const doneKeys = new Set(run?.events.map((e) => e.author) ?? []);
  const working = run?.status === 'running' || run?.render?.status === 'rendering';
  const stepState = (s: Step): 'done' | 'active' | 'todo' => {
    if (!run) return 'todo';
    if (s.key === 'film') return run.render?.status === 'done' ? 'done' : run.render?.status === 'rendering' || run.current === 'film' ? 'active' : 'todo';
    if (run.current === s.key && run.status === 'running') return 'active';
    return doneKeys.has(s.key) || run.status !== 'running' ? 'done' : 'todo';
  };
  const doneCount = steps.filter((s) => stepState(s) === 'done').length;
  const frames = run?.storyboard?.frames.filter((f) => !f.error) ?? [];
  const verdict = run?.review?.verdict;

  return (
    <main className="shell">
      <header className="top">
        <h1>Hidden Force Studio</h1>
        <p className="lede">
          Pick a hero. The studio fetches current guidance on portraying their trait, writes an animated short, reviews it against the rules it found,
          draws a storyboard, and cuts a narrated film. If a draft breaks the rules, it says so, with the line that broke them, and tries again. Three strikes and it refuses.
        </p>
      </header>
      {error && <p className="error">{error}</p>}

      {!run && (
        <section className="step-section">
          <h2><span className="n">1</span> Choose a hero</h2>
          <div className="mode">
            <label className={withFilm ? 'on' : ''}><input type="radio" name="mode" checked={withFilm} onChange={() => setWithFilm(true)} /> Short film <span className="muted">script, storyboard and a narrated one-minute film · about 12 minutes</span></label>
            <label className={!withFilm ? 'on' : ''}><input type="radio" name="mode" checked={!withFilm} onChange={() => setWithFilm(false)} /> Script and storyboard only <span className="muted">about 6 minutes</span></label>
          </div>
          <div className="grid">
            {bibles.map((b) => (
              <button key={b.id} className={`card${b.adversarial ? ' adversarial' : ''}`} disabled={busy} onClick={() => start(b)}>
                <div className="name">{b.name}{b.adversarial ? ' · adversarial' : ''}</div>
                <div className="meta">{b.age}, {b.trait}</div>
                <div className="meta">
                  {b.adversarial
                    ? b.adversarial_revisions === 'unguarded'
                      ? 'Every draft ignores the rules. Expect a refusal after three drafts.'
                      : 'First draft ignores the rules, so you can watch the review catch it.'
                    : b.reframe}
                </div>
                <div className="cta">{withFilm ? 'Make the short' : 'Make the script'}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {run && (
        <section className="run">
          <div className="run-head">
            <h2>
              {run.character}
              {' '}
              <span className={`chip ${verdict ? verdict.toLowerCase() : run.status}`}>{verdict ?? run.status}</span>
              {run.animatic && <span className="chip film"> film</span>}
            </h2>
            <button className="link" onClick={() => { setRun(null); setRunId(null); window.history.replaceState(null, '', window.location.pathname); }}>Choose another hero</button>
          </div>
          {run.error && <p className="error">{run.error}</p>}

          {(working || run.status === 'error') && (
            <div className="panel">
              <h2 style={{ marginTop: 0 }}><span className="n">2</span> Making the short <span className="muted small">{doneCount} of {steps.length} steps</span></h2>
              <div className="bar"><div style={{ width: `${Math.round((100 * doneCount) / Math.max(1, steps.length))}%` }} /></div>
              <ol className="steps">
                {steps.map((s) => {
                  const st = stepState(s);
                  return (
                    <li key={s.key} className={st}>
                      <span className="dot" />
                      <span className="label">{s.label}</span>
                      <span className="detail">{s.detail ?? (st === 'active' ? 'working' : st === 'done' ? 'done' : '')}</span>
                    </li>
                  );
                })}
              </ol>
              {run.review_history.length > 0 && (
                <p className="muted small">
                  {run.review_history.map((r) => `${r.revision_colour} draft: ${r.verdict}${r.hard_failures.length ? ` (${r.hard_failures.join(', ')})` : ''}`).join(' · ')}
                </p>
              )}
            </div>
          )}

          {!working && run.status !== 'error' && (
            <>
              {run.animatic ? (
                <div className="panel">
                  <h2 style={{ marginTop: 0 }}><span className="n">3</span> The short</h2>
                  <video className="film" controls preload="metadata" src={fileUrl(run.folder, run.animatic)} />
                  {run.render?.narration && (
                    <details className="small">
                      <summary className="muted">Narration</summary>
                      <ol>{run.render.narration.map((l, i) => <li key={i}>{l}</li>)}</ol>
                    </details>
                  )}
                  <p className="muted small">Title card, eight narrated shots from Veo 3.1, end card. About a minute.</p>
                </div>
              ) : verdict === 'PASS' ? (
                <div className="panel">
                  <h2 style={{ marginTop: 0 }}><span className="n">3</span> The short</h2>
                  {run.render?.status === 'error' && <p className="error">The film failed: {run.render.error}</p>}
                  {run.film_skipped && !run.render && <p className="muted">{run.film_skipped}</p>}
                  <button className="btn" onClick={makeFilm} disabled={busy}>Make the film</button>
                  <span className="muted small"> Eight shots from Veo, narrated. About six minutes.</span>
                </div>
              ) : (
                <div className="panel">
                  <h2 style={{ marginTop: 0 }}><span className="n">3</span> Refused</h2>
                  <p>This draft did not pass review after three tries, so there is no storyboard and no film. The review below says exactly which lines broke which rules.</p>
                </div>
              )}

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
                  <p className="muted small">This paragraph is pasted, unchanged, at the front of all {run.art_brief.shots.length} shot prompts, every storyboard frame, and every film shot.</p>
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
            </>
          )}
        </section>
      )}

      {recent.length > 0 && (
        <section className="step-section">
          <h2>Finished shorts</h2>
          <p className="muted">Real runs, unedited. Open one to watch the film and read the review.</p>
          <div className="grid">
            {recent.slice(0, 16).map((r) => (
              <button key={r.id} className="card" onClick={() => { setRun(null); setRunId(r.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                <div className="name">
                  {r.character}{' '}
                  {r.verdict ? <span className={`chip ${r.verdict.toLowerCase()}`}>{r.verdict}</span> : <span className={`chip ${r.status}`}>{r.status}</span>}
                  {r.film && <span className="chip film"> film</span>}
                </div>
                <div className="meta mono">{r.id}</div>
                <div className="meta">{new Date(r.started_at).toLocaleString('en-US')}{r.live ? ' · this instance' : ''}</div>
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
