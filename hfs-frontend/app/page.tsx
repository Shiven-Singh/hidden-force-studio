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

type Agent = 'studio' | 'research' | 'rules' | 'writer' | 'reviewer' | 'art' | 'film' | 'files';
const AGENT_NAME: Record<Agent, string> = { studio: 'Studio', research: 'Research', rules: 'Rules', writer: 'Writer', reviewer: 'Reviewer', art: 'Art', film: 'Film', files: 'Files' };
const AGENT_INITIAL: Record<Agent, string> = { studio: 'HF', research: 'R', rules: 'Ru', writer: 'W', reviewer: 'Rv', art: 'A', film: 'F', files: 'Fi' };

interface Msg { id: string; role: 'user' | Agent; at?: number; body: ReactNode }

const fileUrl = (folder: string | undefined, file: string) => `${API}/api/runs/${encodeURIComponent(folder ?? '')}/files/${file}`;
const fmtTime = (ts?: number) => (ts ? new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');
const lower = (s: string) => s.toLowerCase();

/** The stage an agent is on, in words a person would use. */
function workingLine(run: RunView): string | null {
  if (run.status !== 'running') return null;
  const colour = ['White', 'Blue', 'Pink'][run.review_history.length] ?? 'next';
  const sb = run.storyboard_progress;
  const r = run.render;
  switch (run.current) {
    case null:
    case 'intake': return 'Reading the character bible';
    case 'research': return `Searching for current guidance on portraying ${run.character}'s trait`;
    case 'rubric':
    case 'rubric_merge': return 'Turning the sources into rules';
    case 'story': return `Writing the ${colour} draft`;
    case 'gate': return `Reviewing the ${['White', 'Blue', 'Pink'][Math.max(0, run.review_history.length - (run.events.filter((e) => e.author === 'gate').length > run.review_history.length ? 0 : 0))] ?? 'latest'} draft against the rules`;
    case 'lock_character': return 'Locking the character design';
    case 'art_direction': return 'Planning the shots';
    case 'storyboard': return sb ? `Drawing frame ${Math.min(sb.done + 1, sb.total)} of ${sb.total}` : 'Drawing the storyboard';
    case 'package': return 'Packaging the files';
    case 'film': return r ? `Filming shot ${Math.min((r.done_clips ?? 0) + 1, r.clips ?? 8)} of ${r.clips ?? 8}` : 'Writing the narration';
    default: return 'Working';
  }
}

function buildMessages(run: RunView, requestedFilm: boolean): Msg[] {
  const at = (author: string, nth = 0) => run.events.filter((e) => e.author === author)[nth]?.ts;
  const msgs: Msg[] = [];
  msgs.push({ id: 'u', role: 'user', at: run.events[0]?.ts, body: <p>{requestedFilm || run.film ? `Make a short about ${run.character}.` : `Write the script and storyboard for ${run.character}.`}</p> });
  msgs.push({ id: 'intro', role: 'studio', at: at('intake'), body: <p>On it. I&apos;ll look up current guidance on portraying {run.character}&apos;s trait, write the short, review every draft against what I find, then draw the storyboard{run.film ? ' and cut the film' : ''}. If a draft breaks a rule, I&apos;ll say which line and try again.</p> });

  if (run.sources) {
    const adv = run.sources.filter((s) => s.pool === 'advocacy');
    const gen = run.sources.filter((s) => s.pool === 'general');
    msgs.push({ id: 'sources', role: 'research', at: at('research'), body: (
      <>
        <p>Found {run.sources.length} sources: {adv.length} from advocacy groups and style guides, {gen.length} from the open web.</p>
        <details><summary>Show the sources</summary>
          <div className="src-list">{run.sources.map((s) => (
            <div key={s.idx} className="src-item"><a href={s.url} target="_blank" rel="noreferrer">[{s.idx}] {s.title}</a><div className="pub">{s.pool} · {s.publisher}{s.publish_date ? ` · ${s.publish_date}` : ''}</div></div>
          ))}</div>
        </details>
      </>
    ) });
  }

  if (run.rubric) {
    const r = run.rubric;
    msgs.push({ id: 'rules', role: 'rules', at: at('rubric_merge') ?? at('rubric'), body: (
      <>
        <p>Wrote {r.must_do.length + r.must_not_do.length} rules from those sources, each pointing at the source that supports it. Plus three that apply to every story: no cure, no deficit language in the narration, no inspiration porn.</p>
        <details><summary>Show the rules</summary>
          <ul>{r.must_do.map((x) => <li key={x.id}><span className="mono">{x.id}</span> {x.rule} <span className="muted">[{x.source_ref}]</span></li>)}</ul>
          <ul>{r.must_not_do.map((x) => <li key={x.id}><span className="mono">{x.id}</span> {x.rule} <span className="muted">[{x.source_ref}]</span></li>)}</ul>
          {r.avoid_terms.length > 0 && <p className="small muted">Words the narration must not use: {r.avoid_terms.join(', ')}.</p>}
        </details>
      </>
    ) });
  }

  run.review_history.forEach((rev, i) => {
    const sp = run.screenplay;
    msgs.push({ id: `draft-${i}`, role: 'writer', at: at('story', i), body: (
      <p>
        <span className={`chip ${lower(rev.revision_colour)}`}>{rev.revision_colour} draft</span>{' '}
        {i === 0 && sp ? <>&ldquo;{sp.title}&rdquo;. {sp.logline} {sp.beats} beats{sp.words ? `, ${sp.words.toLocaleString('en-US')} words` : ''}.</> : i === 0 ? 'Draft ready.' : 'Redraft ready, with the notes applied.'}
      </p>
    ) });
    const failed = [...rev.deterministic, ...rev.model_scored].filter((s) => rev.hard_failures.includes(s.rule_id));
    msgs.push({ id: `review-${i}`, role: 'reviewer', at: at('gate', i), body: (
      <>
        <p>
          <span className={`chip ${lower(rev.verdict)}`}>{rev.verdict}</span>{' '}
          {rev.verdict === 'PASS' && `Every rule holds. ${rev.evidence_unverified.length === 0 ? 'Every quote I checked exists in the script word for word.' : ''}`}
          {rev.verdict === 'REVISE' && `${failed.length} rule${failed.length > 1 ? 's' : ''} broken. Sending it back with the lines that broke them.`}
          {rev.verdict === 'HALT' && `Still broken after three drafts. I'm refusing this one rather than shipping it.`}
        </p>
        {failed.map((s) => (
          <div key={s.rule_id}>
            <p><span className="mono">{s.rule_id}</span> <span className={`r-${s.result}`}>{s.result}</span> <span className="muted small">{s.note}</span></p>
            {s.evidence && <blockquote>{s.evidence}</blockquote>}
          </div>
        ))}
        <details><summary>All {rev.deterministic.length + rev.model_scored.length} checks</summary>
          {[...rev.deterministic, ...rev.model_scored].map((s) => (
            <div key={s.rule_id} className="rule-row"><span className="mono">{s.rule_id}</span><span className={`r-${s.result}`}>{s.result}</span><div>{s.evidence && <blockquote>{s.evidence}</blockquote>}<div className="note">{s.note}</div></div></div>
          ))}
        </details>
      </>
    ) });
  });

  if (run.art_brief) {
    msgs.push({ id: 'locked', role: 'art', at: at('art_direction'), body: (
      <>
        <p>Locked {run.character}&apos;s design. This paragraph goes, unchanged, at the front of every shot prompt, every storyboard frame and every film shot.</p>
        <div className="locked">{run.art_brief.character.locked_description}</div>
        <div className="hash mono">sha256 {run.art_brief.consistency_hash}</div>
      </>
    ) });
  }

  const frames = run.storyboard?.frames.filter((f) => !f.error) ?? [];
  if (frames.length > 0 || (run.status === 'running' && run.current === 'storyboard')) {
    const sb = run.storyboard_progress;
    msgs.push({ id: 'board', role: 'art', at: at('storyboard'), body: (
      <>
        <p>{frames.length ? `Storyboard, ${frames.length} frames.` : sb ? `Drawing the storyboard, ${sb.done} of ${sb.total} so far.` : 'Drawing the storyboard.'}</p>
        {frames.length > 0 && <div className="board">{frames.map((f) => <figure key={f.shot}><img src={fileUrl(run.folder, f.file)} alt={`Shot ${f.shot}`} loading="lazy" /><figcaption>shot {f.shot} · beat {f.beat}</figcaption></figure>)}</div>}
      </>
    ) });
  }

  if (run.animatic) {
    msgs.push({ id: 'film', role: 'film', at: at('film'), body: (
      <>
        <p>The short. A title card, {run.render?.clips ?? 8} narrated shots, and a closing card with what the review found.</p>
        <video className="film" controls preload="metadata" src={fileUrl(run.folder, run.animatic)} />
        {run.render?.narration && <details><summary>Narration</summary><ol>{run.render.narration.map((l, i) => <li key={i}>{l}</li>)}</ol></details>}
      </>
    ) });
  } else if (run.render?.status === 'rendering') {
    msgs.push({ id: 'film', role: 'film', at: at('film'), body: <p>Filming. {run.render.done_clips ?? 0} of {run.render.clips ?? 8} shots done. Each shot takes about a minute.</p> });
  } else if (run.render?.status === 'error') {
    msgs.push({ id: 'film', role: 'film', at: at('film'), body: <p className="error">The film failed: {run.render.error}. You can try again from the button below.</p> });
  } else if (run.film_skipped && run.status !== 'running') {
    msgs.push({ id: 'film', role: 'film', body: <p className="muted">{run.film_skipped}</p> });
  }

  if (run.package) {
    msgs.push({ id: 'files', role: 'files', at: at('package'), body: (
      <>
        <p>Packaged. Every file is in storage, unedited.</p>
        <ul className="files">{run.package.files.map((f) => <li key={f} className="mono"><a href={fileUrl(run.folder, f)} target="_blank" rel="noreferrer">{f}</a></li>)}</ul>
        {run.manifest && <p className="small muted">draft model {run.manifest.models.draft} · review model {run.manifest.models.review} · ADK {run.manifest.adk_version}</p>}
      </>
    ) });
  }

  if (run.status === 'error') msgs.push({ id: 'err', role: 'studio', body: <p className="error">Something went wrong: {run.error}</p> });
  return msgs;
}

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

  const messages = useMemo(() => (run ? buildMessages(run, withFilm) : []), [run, withFilm]);
  const working = run ? workingLine(run) : null;

  useEffect(() => {
    const el = threadRef.current;
    if (el && run?.status === 'running') el.scrollTop = el.scrollHeight;
  }, [messages.length, working]);

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
    if (!bible) { setError('Name one of the heroes, or pick one below.'); return; }
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

  return (
    <div className={`app${sideOpen ? ' side-open' : ''}`}>
      <aside className="side">
        <div className="brand"><div className="mark">HF</div><div><div className="name">Hidden Force Studio</div><div className="tag">an animation studio you talk to</div></div></div>
        <button className="new" onClick={() => { setRunId(null); setRun(null); setError(null); setSideOpen(false); }}>+ New short</button>
        <h4>Shorts</h4>
        <ul className="threads">
          {recent.map((r) => (
            <li key={r.id}>
              <button className={runId === r.id ? 'active' : ''} onClick={() => { setRun(null); setRunId(r.id); setSideOpen(false); }}>
                <span className="t">{r.title ?? r.character}</span>
                <span className={`chip ${lower(r.verdict ?? r.status)}`}>{r.verdict ?? r.status}</span>
                <span className="s">{r.character}{r.film ? ' · film' : ''} · {new Date(r.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="foot">Gemini on Vertex AI · Parallel Search · Veo 3.1 · every run is real and unedited</div>
      </aside>

      <section className="main">
        <div className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setSideOpen((v) => !v)}>Shorts</button>
          <div>
            <div className="title">{run ? (run.screenplay?.title ?? run.character) : 'New short'}</div>
            <div className="sub">{run ? `${run.character}${run.folder ? ` · ${run.folder}` : ''}` : 'Pick a hero and the studio takes it from there'}</div>
          </div>
          <div className="spacer" />
          {run && verdict && <span className={`chip ${lower(verdict)}`}>{verdict}</span>}
          {canFilm && <button className="icon-btn" onClick={makeFilm} disabled={busy}>Make the film</button>}
        </div>

        <div className="thread" ref={threadRef}>
          {!run && (
            <div className="hello">
              <h1>What should we make?</h1>
              <p>Pick a hero. The studio fetches current guidance on portraying their trait, writes an animated short, reviews every draft against the rules it found, draws a storyboard and cuts a narrated film. If a draft breaks a rule, it tells you which line, and tries again. Three strikes and it refuses.</p>
              <div className="hero-grid">
                {bibles.map((b) => (
                  <button key={b.id} className={`hero${b.adversarial ? ' adv' : ''}`} disabled={busy} onClick={() => start(b)}>
                    {b.adversarial && <span className="badge">{b.adversarial_revisions === 'unguarded' ? 'adversarial · expect a refusal' : 'adversarial · watch the review catch it'}</span>}
                    <span className="n">{b.name}</span>
                    <span className="d">{b.age} · {b.trait}</span>
                    <span className="d">{b.reframe}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {run && (
            <div className="thread-inner">
              {messages.map((m) => (
                <div key={m.id} className={`msg${m.role === 'user' ? ' user' : ''}`}>
                  {m.role !== 'user' && <div className={`avatar ${m.role}`}>{AGENT_INITIAL[m.role]}</div>}
                  <div className="bubble">
                    <div className="meta"><span className="who">{m.role === 'user' ? 'You' : AGENT_NAME[m.role]}</span><span className="when">{fmtTime(m.at)}</span></div>
                    <div className="body">{m.body}</div>
                  </div>
                </div>
              ))}
              {working && (
                <div className="msg">
                  <div className="avatar studio">HF</div>
                  <div className="bubble"><div className="meta"><span className="who">Studio</span></div><div className="body"><p>{working}<span className="typing"><i /><i /><i /></span></p></div></div>
                </div>
              )}
              {error && <p className="error">{error}</p>}
            </div>
          )}
          {!run && error && <p className="error" style={{ maxWidth: 860, margin: '12px auto' }}>{error}</p>}
        </div>

        <div className="composer">
          <div className="composer-inner">
            <div className="chips">
              {bibles.map((b) => (
                <button key={b.id} className={`${picked === b.id ? 'on' : ''}${b.adversarial ? ' adv' : ''}`} onClick={() => setPicked(picked === b.id ? null : b.id)} title={b.adversarial ? (b.adversarial_revisions === 'unguarded' ? 'every draft ignores the rules; expect a refusal' : 'first draft ignores the rules; watch the review catch it') : b.reframe}>
                  {b.name}{b.adversarial ? (b.adversarial_revisions === 'unguarded' ? ' · halt' : ' · adversarial') : ''}
                </button>
              ))}
            </div>
            <div className="box">
              <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder={picked ? `Make a short about ${bibles.find((b) => b.id === picked)?.name}` : 'Make a short about Zayan'} disabled={busy || run?.status === 'running'} />
              <div className="seg">
                <button className={withFilm ? 'on' : ''} onClick={() => setWithFilm(true)}>Film</button>
                <button className={!withFilm ? 'on' : ''} onClick={() => setWithFilm(false)}>Script only</button>
              </div>
              <button className="send" onClick={submit} disabled={busy || run?.status === 'running' || (!picked && !text.trim())}>Make</button>
            </div>
            <div className="hint">A short takes about 12 minutes with the film, 6 without. Everything the studio says is backed by a file you can open.</div>
          </div>
        </div>
      </section>
    </div>
  );
}
