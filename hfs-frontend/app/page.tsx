'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ArtBrief, CharacterBible, PortrayalRubric, ReviewReport, RunManifest, Source } from '@hfs/schemas';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

type Bible = CharacterBible & { id: string };

interface StoryboardFrame { shot: number; beat: number; file: string; prompt: string; error?: string }
interface RenderStatus { status: 'rendering' | 'done' | 'error'; clips?: number; done_clips?: number; error?: string; narration?: string[]; voice?: string }
interface ScreenplaySummary { title: string; logline: string; beats: number; words?: number; pages?: number }

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
  screenplay?: ScreenplaySummary;
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
  title?: string;
  film?: boolean;
  started_at: number;
  live: boolean;
}

type Dept = 'production' | 'research' | 'standards' | 'script' | 'review' | 'design' | 'film' | 'delivery';
const DEPT_NAME: Record<Dept, string> = { production: 'Production', research: 'Research', standards: 'Standards', script: 'Script', review: 'Review', design: 'Design', film: 'Film', delivery: 'Delivery' };
const DEPT_CODE: Record<Dept, string> = { production: 'PR', research: 'RS', standards: 'ST', script: 'SC', review: 'RV', design: 'DS', film: 'FM', delivery: 'DL' };

interface Entry { id: string; role: 'user' | Dept; at?: number; body: ReactNode }

const fileUrl = (folder: string | undefined, file: string) => `${API}/api/runs/${encodeURIComponent(folder ?? '')}/files/${file}`;
const fmtTime = (ts?: number) => (ts ? new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
const lower = (s: string) => s.toLowerCase();
const COLOURS = ['White', 'Blue', 'Pink'];

function workingLine(run: RunView): string | null {
  if (run.status !== 'running') return null;
  const draftNo = run.review_history.length;
  const sb = run.storyboard_progress;
  const r = run.render;
  switch (run.current) {
    case null:
    case 'intake': return 'Reading the character bible';
    case 'research': return 'Retrieving portrayal guidance via Parallel Search';
    case 'rubric':
    case 'rubric_merge': return 'Compiling standards from the sources';
    case 'story': return `Writing the ${COLOURS[draftNo] ?? 'next'} draft`;
    case 'gate': return `Reviewing the ${COLOURS[Math.max(0, draftNo)] ?? 'latest'} draft`;
    case 'lock_character': return 'Locking the character design';
    case 'art_direction': return 'Building the shot list';
    case 'storyboard': return sb ? `Storyboard frame ${Math.min(sb.done + 1, sb.total)} of ${sb.total}` : 'Drawing the storyboard';
    case 'package': return 'Writing the package';
    case 'film': return r ? `Filming shot ${Math.min((r.done_clips ?? 0) + 1, r.clips ?? 8)} of ${r.clips ?? 8}` : 'Writing narration';
    default: return 'Working';
  }
}

function buildEntries(run: RunView): Entry[] {
  const at = (author: string, nth = 0) => (run.archived ? undefined : run.events.filter((e) => e.author === author)[nth]?.ts);
  const out: Entry[] = [];
  out.push({ id: 'u', role: 'user', at: run.events[0]?.ts, body: <p>Production request: {run.character}. {run.film || run.animatic ? 'Script, storyboard and film.' : 'Script and storyboard.'}</p> });
  out.push({ id: 'pr', role: 'production', at: at('intake'), body: <p>Production opened for {run.character}. Pipeline: research, standards, script, review, design, storyboard{run.film || run.animatic ? ', film' : ''}. A draft that fails review is returned with the failing lines; after three failures the production is refused.</p> });

  if (run.sources) {
    const adv = run.sources.filter((s) => s.pool === 'advocacy');
    const gen = run.sources.filter((s) => s.pool === 'general');
    out.push({ id: 'rs', role: 'research', at: at('research'), body: (
      <>
        <p>{run.sources.length} sources retrieved via Parallel Search API. {adv.length} from advocacy organizations and style guides, {gen.length} from the open web. Stored verbatim with pool labels.</p>
        <details><summary>Sources</summary>
          <div className="src-list">{run.sources.map((s) => (
            <div key={s.idx} className="src-item"><a href={s.url} target="_blank" rel="noreferrer">[{s.idx}] {s.title}</a><div className="pub">{s.pool} · {s.publisher}{s.publish_date ? ` · ${s.publish_date}` : ''}</div></div>
          ))}</div>
        </details>
      </>
    ) });
  }

  if (run.rubric) {
    const r = run.rubric;
    out.push({ id: 'st', role: 'standards', at: at('rubric_merge') ?? at('rubric'), body: (
      <>
        <p>{r.must_do.length + r.must_not_do.length} rules compiled, each citing its source. Three fixed rules apply to every production: no cure narrative, no deficit framing in narration, no inspiration framing.</p>
        <details><summary>Rules</summary>
          <ul>{r.must_do.map((x) => <li key={x.id}><span className="mono">{x.id}</span> {x.rule} <span className="muted mono">[{x.source_ref}]</span></li>)}</ul>
          <ul>{r.must_not_do.map((x) => <li key={x.id}><span className="mono">{x.id}</span> {x.rule} <span className="muted mono">[{x.source_ref}]</span></li>)}</ul>
          {r.avoid_terms.length > 0 && <p className="small muted">Terms barred from narration: {r.avoid_terms.join(', ')}.</p>}
        </details>
      </>
    ) });
  }

  run.review_history.forEach((rev, i) => {
    const sp = run.screenplay;
    out.push({ id: `sc-${i}`, role: 'script', at: at('story', i), body: (
      <p>
        <span className={`chip ${lower(rev.revision_colour)}`}>{rev.revision_colour} draft</span>{' '}
        {i === 0 && sp ? <>&ldquo;{sp.title}&rdquo;. {sp.logline} {sp.beats} beats{sp.words ? `, ${sp.words.toLocaleString('en-US')} words` : ''}.</> : i === 0 ? 'Draft submitted.' : 'Redraft submitted with review notes applied.'}
      </p>
    ) });
    const failed = [...rev.deterministic, ...rev.model_scored].filter((s) => rev.hard_failures.includes(s.rule_id));
    const total = rev.deterministic.length + rev.model_scored.length;
    out.push({ id: `rv-${i}`, role: 'review', at: at('gate', i), body: (
      <>
        <p>
          <span className={`chip ${lower(rev.verdict)}`}>{rev.verdict}</span>{' '}
          {rev.verdict === 'PASS' && `${total} checks. All evidence verified against the script.`}
          {rev.verdict === 'REVISE' && `${failed.length} of ${total} checks failed. Returned to Script with the failing lines.`}
          {rev.verdict === 'HALT' && `Failed on the third draft. Production refused.`}
        </p>
        {failed.map((s) => (
          <div key={s.rule_id}>
            <p><span className="mono">{s.rule_id}</span> <span className={`r-${s.result}`}>{s.result}</span> <span className="muted small">{s.note}</span></p>
            {s.evidence && <blockquote>{s.evidence}</blockquote>}
          </div>
        ))}
        <details><summary>All {total} checks</summary>
          {[...rev.deterministic, ...rev.model_scored].map((s) => (
            <div key={s.rule_id} className="rule-row"><span className="mono">{s.rule_id}</span><span className={`r-${s.result}`}>{s.result}</span><div>{s.evidence && <blockquote>{s.evidence}</blockquote>}<div className="note">{s.note}</div></div></div>
          ))}
        </details>
      </>
    ) });
  });

  if (run.art_brief) {
    out.push({ id: 'ds', role: 'design', at: at('art_direction'), body: (
      <>
        <p>Character locked. This description is prepended verbatim to all {run.art_brief.shots.length} shot prompts, every storyboard frame and every film shot.</p>
        <div className="locked">{run.art_brief.character.locked_description}</div>
        <div className="hash mono">sha256 {run.art_brief.consistency_hash}</div>
      </>
    ) });
  }

  const frames = run.storyboard?.frames.filter((f) => !f.error) ?? [];
  if (frames.length > 0 || (run.status === 'running' && run.current === 'storyboard')) {
    const sb = run.storyboard_progress;
    out.push({ id: 'sb', role: 'design', at: at('storyboard'), body: (
      <>
        <p>{frames.length ? `Storyboard: ${frames.length} frames.` : sb ? `Storyboard in progress, ${sb.done} of ${sb.total}.` : 'Storyboard in progress.'}</p>
        {frames.length > 0 && <div className="board">{frames.map((f) => <figure key={f.shot}><img src={fileUrl(run.folder, f.file)} alt={`Shot ${f.shot}`} loading="lazy" /><figcaption>{String(f.shot).padStart(2, '0')} · beat {f.beat}</figcaption></figure>)}</div>}
      </>
    ) });
  }

  if (run.animatic) {
    out.push({ id: 'fm', role: 'film', at: at('film'), body: (
      <>
        <p>Film delivered. Title card, {run.render?.clips ?? 8} narrated shots, end card with the review result.</p>
        <video className="film" controls preload="metadata" src={fileUrl(run.folder, run.animatic)} />
        {run.render?.narration && <details><summary>Narration</summary><ol>{run.render.narration.map((l, i) => <li key={i}>{l}</li>)}</ol></details>}
      </>
    ) });
  } else if (run.render?.status === 'rendering') {
    out.push({ id: 'fm', role: 'film', at: at('film'), body: <p>Filming. {run.render.done_clips ?? 0} of {run.render.clips ?? 8} shots complete.</p> });
  } else if (run.render?.status === 'error') {
    out.push({ id: 'fm', role: 'film', at: at('film'), body: <p className="error">Film failed: {run.render.error}</p> });
  } else if (run.film_skipped && run.status !== 'running') {
    out.push({ id: 'fm', role: 'film', body: <p className="muted">{run.film_skipped}</p> });
  }

  if (run.package) {
    out.push({ id: 'dl', role: 'delivery', at: at('package'), body: (
      <>
        <p>Package written to storage. {run.package.files.length} files.</p>
        <ul className="files">{run.package.files.map((f) => <li key={f} className="mono"><a href={fileUrl(run.folder, f)} target="_blank" rel="noreferrer">{f}</a></li>)}</ul>
      </>
    ) });
  }

  if (run.status === 'error') out.push({ id: 'err', role: 'production', body: <p className="error">Production stopped: {run.error}</p> });
  return out;
}

const STAGE_LABEL: Record<string, string> = {
  intake: 'Intake', research: 'Research', rubric: 'Standards', rubric_merge: 'Standards', story: 'Script', gate: 'Review',
  lock_character: 'Design lock', art_direction: 'Shot list', storyboard: 'Storyboard', package: 'Package', film: 'Film',
};

export default function Page() {
  const [bibles, setBibles] = useState<Bible[]>([]);
  const [recent, setRecent] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withFilm, setWithFilm] = useState(true);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [sideOpen, setSideOpen] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const loadRecent = () => fetch(`${API}/api/runs`).then((r) => r.json()).then((rs: RunSummary[]) => setRecent([...rs].reverse())).catch(() => undefined);

  useEffect(() => {
    fetch(`${API}/api/bibles`).then((r) => r.json()).then(setBibles).catch((e) => setError(String(e)));
    void loadRecent();
    const wanted = new URLSearchParams(window.location.search).get('run');
    if (wanted && /^[a-z0-9_-]+$/i.test(wanted)) setRunId(wanted);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (runId) url.searchParams.set('run', runId); else url.searchParams.delete('run');
    window.history.replaceState(null, '', url.toString());
  }, [runId]);

  useEffect(() => { if (run && run.status !== 'running') void loadRecent(); }, [run?.status]);

  useEffect(() => {
    if (!runId) { setRun(null); return; }
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`${API}/api/runs/${runId}`);
        const data = (await r.json()) as RunView;
        if (!stop) setRun(data);
        const working = data.status === 'running' || data.render?.status === 'rendering';
        if (!stop && working) setTimeout(tick, 3000);
      } catch {
        if (!stop) setTimeout(tick, 5000);
      }
    };
    void tick();
    return () => { stop = true; };
  }, [runId]);

  const entries = useMemo(() => (run ? buildEntries(run) : []), [run]);
  const working = run ? workingLine(run) : null;

  useEffect(() => {
    const el = threadRef.current;
    if (el && run?.status === 'running') el.scrollTop = el.scrollHeight;
  }, [entries.length, working]);

  const start = async (bible: Bible) => {
    setError(null);
    setBusy(true);
    const { id, ...body } = bible;
    void id;
    const r = await fetch(`${API}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, film: withFilm }) });
    setBusy(false);
    if (!r.ok) { setError(`Could not start: ${r.status}`); return; }
    const { run_id } = (await r.json()) as { run_id: string };
    setText('');
    setPicked(null);
    setRun(null);
    setRunId(run_id);
    setSideOpen(false);
  };

  const submit = () => {
    const q = text.trim().toLowerCase();
    const byPick = picked ? bibles.find((b) => b.id === picked) : undefined;
    const byText = q ? bibles.find((b) => q.includes(b.name.toLowerCase()) && (q.includes('halt') ? b.adversarial_revisions === 'unguarded' : q.includes('adversarial') ? b.adversarial && b.adversarial_revisions !== 'unguarded' : !b.adversarial)) : undefined;
    const bible = byPick ?? byText;
    if (!bible) { setError('Name a character from the roster, or select one.'); return; }
    if (q.includes('script only') || q.includes('no film')) setWithFilm(false);
    void start(bible);
  };

  const makeFilm = async () => {
    if (!run?.folder) return;
    setBusy(true);
    const r = await fetch(`${API}/api/runs/${encodeURIComponent(run.folder)}/render`, { method: 'POST' });
    setBusy(false);
    if (!r.ok) { const b = (await r.json().catch(() => ({}))) as { error?: string }; setError(b.error ?? `Could not start the film: ${r.status}`); return; }
    setRun(null);
    setRunId(run.folder);
  };

  const verdict = run?.review?.verdict;
  const canFilm = run && run.status !== 'running' && verdict === 'PASS' && !run.animatic && run.render?.status !== 'rendering';
  const stageTs = (s: string) => (run?.archived ? undefined : run?.events.filter((e) => e.author === s).at(-1)?.ts);
  const pipeline = run ? [...run.stages.filter((s) => s !== 'rubric_merge'), ...(run.animatic && !run.stages.includes('film') ? ['film'] : [])].map((s) => {
    const done = s === 'film' ? run.render?.status === 'done' : run.events.some((e) => e.author === s) && (run.current !== s || run.status !== 'running');
    const active = run.status === 'running' && (run.current === s || (s === 'rubric' && run.current === 'rubric_merge')) || (s === 'film' && run.render?.status === 'rendering');
    return { key: s, label: STAGE_LABEL[s] ?? s, state: done ? 'done' : active ? 'active' : 'todo', ts: stageTs(s) };
  }) : [];

  return (
    <div className={`app${sideOpen ? ' side-open' : ''}`}>
      <aside className="side">
        <div className="brand"><div className="mark">HF</div><div><div className="name">Hidden Force Studio</div><div className="tag">Production pipeline</div></div></div>
        <div className="actions"><button className="new" onClick={() => { setRunId(null); setRun(null); setError(null); setSideOpen(false); }}>New production</button></div>
        <h4 className="label">Productions</h4>
        <ul className="threads">
          {recent.map((r) => (
            <li key={r.id}>
              <button className={runId === r.id ? 'active' : ''} onClick={() => { setRun(null); setRunId(r.id); setSideOpen(false); }}>
                <span className="t">{r.title ?? r.character}</span>
                <span className={`chip ${lower(r.verdict ?? r.status)}`}>{r.verdict ?? r.status}</span>
                <span className="s">{r.character}{r.film ? ' · film' : ''} · {new Date(r.started_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="foot">Gemini on Vertex AI · Parallel Search API · Veo 3.1 · Cloud Text-to-Speech. Every production is real and unedited.</div>
      </aside>

      <section className="main">
        <div className="topbar">
          <button className="btn menu-btn" onClick={() => setSideOpen((v) => !v)}>Productions</button>
          <div>
            <div className="title">{run ? (run.screenplay?.title ?? run.character) : 'New production'}</div>
            <div className="sub">{run ? `${run.character}${run.folder ? ` · ${run.folder}` : ''}` : 'Select a character to open a production'}</div>
          </div>
          <div className="spacer" />
          {run && verdict && <span className={`chip ${lower(verdict)}`}>{verdict}</span>}
          {canFilm && <button className="btn" onClick={makeFilm} disabled={busy}>Render film</button>}
        </div>

        <div className="thread" ref={threadRef}>
          {!run && (
            <div className="roster">
              <h1>Character roster</h1>
              <p>Select a character to open a production. Research retrieves current portrayal guidance for the trait, Standards compiles it into cited rules, Script drafts, Review checks every rule with verified quotes, Design locks the character and draws the storyboard, Film cuts a narrated short. A draft that fails review three times is refused.</p>
              <table>
                <thead><tr><th>Character</th><th>Age</th><th>Trait</th><th>Premise</th><th></th></tr></thead>
                <tbody>
                  {bibles.map((b) => (
                    <tr key={b.id}>
                      <td className="n">{b.name}{b.adversarial && <span className="tag adv">{b.adversarial_revisions === 'unguarded' ? 'adversarial · refuse' : 'adversarial'}</span>}</td>
                      <td>{b.age}</td>
                      <td>{b.trait}</td>
                      <td className="note">{b.adversarial ? (b.adversarial_revisions === 'unguarded' ? 'Every draft ignores the standards. Demonstrates the refusal path.' : 'First draft ignores the standards. Demonstrates review catching a cure narrative.') : b.reframe}</td>
                      <td className="act"><button className="btn primary" disabled={busy} onClick={() => start(b)}>{withFilm ? 'Start production' : 'Script only'}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {run && (
            <div className="thread-inner">
              {entries.map((m) => (
                <div key={m.id} className={`entry${m.role === 'user' ? ' user' : ''}`}>
                  {m.role !== 'user' && <div className="dept">{DEPT_CODE[m.role]}</div>}
                  <div>
                    <div className="meta"><span className="who">{m.role === 'user' ? 'Request' : DEPT_NAME[m.role]}</span><span className="when">{fmtTime(m.at)}</span></div>
                    <div className="body">{m.body}</div>
                  </div>
                </div>
              ))}
              {working && (
                <div className="entry">
                  <div className="dept">PR</div>
                  <div><div className="meta"><span className="who">Production</span></div><div className="body"><p>{working}<span className="typing"><i /><i /><i /></span></p></div></div>
                </div>
              )}
              {error && <p className="error">{error}</p>}
            </div>
          )}
          {!run && error && <p className="error" style={{ maxWidth: 900, margin: '12px auto' }}>{error}</p>}
        </div>

        <div className="composer">
          <div className="composer-inner">
            <div className="chips">
              {bibles.map((b) => (
                <button key={b.id} className={`${picked === b.id ? 'on' : ''}${b.adversarial ? ' adv' : ''}`} onClick={() => setPicked(picked === b.id ? null : b.id)}>
                  {b.name}{b.adversarial ? (b.adversarial_revisions === 'unguarded' ? ' · refuse' : ' · adversarial') : ''}
                </button>
              ))}
            </div>
            <div className="box">
              <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder={picked ? `Start production: ${bibles.find((b) => b.id === picked)?.name}` : 'Start production: character name'} disabled={busy || run?.status === 'running'} />
              <div className="seg">
                <button className={withFilm ? 'on' : ''} onClick={() => setWithFilm(true)}>Film</button>
                <button className={!withFilm ? 'on' : ''} onClick={() => setWithFilm(false)}>Script only</button>
              </div>
              <button className="btn primary" onClick={submit} disabled={busy || run?.status === 'running' || (!picked && !text.trim())}>Start</button>
            </div>
            <div className="hint">About 12 minutes with film, 6 without. Every statement in the log is backed by a file in storage.</div>
          </div>
        </div>
      </section>

      <aside className="inspector">
        {run ? (
          <>
            <section>
              <div className="label">Production</div>
              <dl className="kv">
                <dt>Character</dt><dd>{run.character}</dd>
                <dt>Status</dt><dd>{verdict ? <span className={`chip ${lower(verdict)}`}>{verdict}</span> : run.status}</dd>
                {run.screenplay && <><dt>Title</dt><dd>{run.screenplay.title}</dd></>}
                {run.screenplay?.words && <><dt>Length</dt><dd>{run.screenplay.beats} beats · {run.screenplay.words.toLocaleString('en-US')} words</dd></>}
                {run.review_history.length > 0 && <><dt>Drafts</dt><dd>{run.review_history.map((r) => `${r.revision_colour}: ${r.verdict}`).join(' · ')}</dd></>}
                {run.folder && <><dt>Folder</dt><dd className="mono">{run.folder}</dd></>}
              </dl>
            </section>
            <section>
              <div className="label">Pipeline</div>
              <ul className="pipeline">
                {pipeline.map((p) => <li key={p.key} className={p.state}><span className="dot" /><span>{p.label}</span><span className="t">{p.state === 'done' ? fmtTime(p.ts) : p.state === 'active' ? 'running' : ''}</span></li>)}
              </ul>
            </section>
            {(run.animatic || run.storyboard || run.package) && (
              <section>
                <div className="label">Deliverables</div>
                <ul className="assets">
                  {run.animatic && <li><span className="k">Film</span><a href={fileUrl(run.folder, run.animatic)} target="_blank" rel="noreferrer">animatic.mp4</a></li>}
                  {run.storyboard && <li><span className="k">Storyboard</span><span>{run.storyboard.frames.filter((f) => !f.error).length} frames</span></li>}
                  {run.package?.files.includes('screenplay.fountain') && <li><span className="k">Screenplay</span><a href={fileUrl(run.folder, 'screenplay.fountain')} target="_blank" rel="noreferrer">screenplay.fountain</a></li>}
                  {run.package?.files.includes('screenplay.rejected.fountain') && <li><span className="k">Rejected draft</span><a href={fileUrl(run.folder, 'screenplay.rejected.fountain')} target="_blank" rel="noreferrer">screenplay.rejected.fountain</a></li>}
                  {run.package?.files.includes('review_history.json') && <li><span className="k">Review</span><a href={fileUrl(run.folder, 'review_history.json')} target="_blank" rel="noreferrer">review_history.json</a></li>}
                  {run.package?.files.includes('portrayal_rubric.json') && <li><span className="k">Standards</span><a href={fileUrl(run.folder, 'portrayal_rubric.json')} target="_blank" rel="noreferrer">portrayal_rubric.json</a></li>}
                  {run.package?.files.includes('run_manifest.json') && <li><span className="k">Manifest</span><a href={fileUrl(run.folder, 'run_manifest.json')} target="_blank" rel="noreferrer">run_manifest.json</a></li>}
                </ul>
              </section>
            )}
            {run.manifest && (
              <section>
                <div className="label">Models</div>
                <dl className="kv">
                  <dt>Draft</dt><dd className="mono">{run.manifest.models.draft}</dd>
                  <dt>Review</dt><dd className="mono">{run.manifest.models.review}</dd>
                  <dt>ADK</dt><dd className="mono">{run.manifest.adk_version}</dd>
                  <dt>Sources</dt><dd>{run.manifest.source_urls.length} cited</dd>
                </dl>
              </section>
            )}
          </>
        ) : (
          <section>
            <div className="label">Pipeline</div>
            <ul className="pipeline">
              {['Intake', 'Research', 'Standards', 'Script', 'Review', 'Design lock', 'Shot list', 'Storyboard', 'Package', 'Film'].map((s) => <li key={s} className="todo"><span className="dot" /><span>{s}</span><span className="t" /></li>)}
            </ul>
            <p className="small muted">Review returns a draft with the failing lines. Two revisions maximum, then the production is refused.</p>
          </section>
        )}
      </aside>
    </div>
  );
}
