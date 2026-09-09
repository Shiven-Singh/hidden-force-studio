'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ArtBrief, CharacterBible, PortrayalRubric, ReviewReport, RuleScore, RunManifest, Source } from '@hfs/schemas';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';
const REPO = 'https://github.com/Shiven-Singh/hidden-force-studio';

type Bible = CharacterBible & { id: string };
type TestKind = 'cure' | 'refuse' | null;

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

const fileUrl = (folder: string | undefined, file: string) => `${API}/api/runs/${encodeURIComponent(folder ?? '')}/files/${file}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const word = (n: number) => WORDS[n] ?? String(n);
const ORDINAL = ['first', 'second', 'third'];
const FIXED_RULES: Record<string, string> = {
  HF1: 'No miracle cure. The kid keeps their trait at the end.',
  HF2: 'No pity words in the narration.',
  HF3: 'The kid is not there to inspire everyone else.',
  'SC-LENGTH': 'The script is the right length.',
  'SC-NAMED': 'The trait is named plainly at least once.',
  'SC-BEATS': 'The trait matters in every beat of the story.',
};
const FILE_LABEL: Record<string, string> = {
  'screenplay.fountain': 'The script',
  'screenplay.rejected.fountain': 'The rejected script',
  'screenplay.json': 'The script, as data',
  'beat_sheet.md': 'Beat sheet',
  'one_sheet.md': 'One-page summary',
  'portrayal_rubric.json': 'House rules and sources',
  'review_history.json': 'Every check, every draft',
  'art_brief.json': 'How the kid looks, and the shot plan',
  'storyboard.json': 'Storyboard plan',
  'run_manifest.json': 'Run details',
};

const testKind = (b: Bible | undefined): TestKind => (!b?.adversarial ? null : b.adversarial_revisions === 'unguarded' ? 'refuse' : 'cure');
const testKindOfFolder = (folder?: string): TestKind => (folder?.includes('adversarial_unguarded') ? 'refuse' : folder?.includes('adversarial') ? 'cure' : null);
const resultWord = (r: RuleScore['result']) => (r === 'pass' ? 'passed' : r === 'fail' ? 'failed' : 'unclear');

function liveLine(run: RunView, name: string): string {
  const n = run.review_history.length;
  const sb = run.storyboard_progress;
  const r = run.render;
  if (r?.status === 'rendering') return r.done_clips === undefined ? 'Writing the narration' : `Filming shot ${Math.min(r.done_clips + 1, r.clips ?? 8)} of ${r.clips ?? 8}`;
  switch (run.current) {
    case null:
    case 'intake': return `Reading ${name}'s file`;
    case 'research': return `Finding out how kids like ${name} should be shown`;
    case 'rubric':
    case 'rubric_merge': return 'Turning what it found into house rules for this story';
    case 'story': return `Writing the ${ORDINAL[n] ?? 'next'} draft`;
    case 'gate': return `Reading the ${ORDINAL[n] ?? 'latest'} draft against the rules`;
    case 'lock_character': return `Pinning down exactly how ${name} looks`;
    case 'art_direction': return 'Planning the shots';
    case 'storyboard': return sb ? `Drawing frame ${Math.min(sb.done + 1, sb.total)} of ${sb.total}` : 'Drawing the storyboard';
    case 'package': return 'Saving everything';
    case 'film': return 'Writing the narration';
    default: return 'Working';
  }
}

interface Step { key: string; label: string; sub?: string; state: 'done' | 'active' | 'todo' | 'stopped' }

function buildSteps(run: RunView, name: string): Step[] {
  const running = run.status === 'running';
  const cur = run.current;
  const has = (a: string) => run.events.some((e) => e.author === a);
  const state = (keys: string[]): Step['state'] => {
    const active = running && cur !== null && keys.includes(cur);
    if (active) return 'active';
    return keys.some(has) ? 'done' : 'todo';
  };
  const verdicts = run.review_history.map((r, i) => (r.verdict === 'PASS' ? `Draft ${i + 1} passed.` : r.verdict === 'REVISE' ? `Draft ${i + 1} went back with ${r.hard_failures.length} note${r.hard_failures.length === 1 ? '' : 's'}.` : `Draft ${i + 1} failed again.`));
  const scriptState: Step['state'] = run.review?.verdict === 'HALT' ? 'stopped' : running && (cur === 'story' || cur === 'gate') ? 'active' : run.review?.verdict === 'PASS' ? 'done' : 'todo';
  const filmState: Step['state'] = run.animatic || run.render?.status === 'done' ? 'done' : run.render?.status === 'rendering' || (running && cur === 'film') ? 'active' : 'todo';
  const steps: Step[] = [
    { key: 'research', label: `Find out how kids like ${name} should be shown`, sub: run.sources ? `${run.sources.length} sources found` : undefined, state: state(['research']) },
    { key: 'rules', label: 'Write the house rules for this story', sub: run.rubric ? `${run.rubric.must_do.length + run.rubric.must_not_do.length} rules, each tied to a source` : undefined, state: state(['rubric', 'rubric_merge']) },
    { key: 'script', label: 'Write the script and check it against the rules', sub: verdicts.length ? verdicts.join(' ') : undefined, state: scriptState },
    { key: 'look', label: `Pin down how ${name} looks`, state: state(['lock_character', 'art_direction']) },
    { key: 'board', label: 'Draw the storyboard', sub: run.storyboard_progress ? `${run.storyboard_progress.done} of ${run.storyboard_progress.total} frames` : undefined, state: state(['storyboard']) },
    { key: 'save', label: 'Save everything', state: state(['package']) },
  ];
  if (run.film || run.animatic || run.render) steps.push({ key: 'film', label: 'Film it and record the narration', sub: run.render?.status === 'rendering' && run.render.done_clips !== undefined ? `${run.render.done_clips} of ${run.render.clips ?? 8} shots filmed` : undefined, state: filmState });
  if (run.review?.verdict === 'HALT') for (const s of steps) if (s.state === 'todo') s.state = 'stopped';
  return steps;
}

interface Chapter { id: string; tone?: 'ok' | 'warn' | 'bad' | 'live'; title: string; detail?: ReactNode; body?: ReactNode }

function ruleText(id: string, rubric?: PortrayalRubric): string {
  if (FIXED_RULES[id]) return FIXED_RULES[id];
  const r = rubric ? [...rubric.must_do, ...rubric.must_not_do].find((x) => x.id === id) : undefined;
  return r?.rule ?? id;
}

function buildChapters(run: RunView, hero: Bible | undefined, test: TestKind): Chapter[] {
  const name = run.character;
  const trait = hero?.trait ?? 'this';
  const out: Chapter[] = [];
  const srcOf = (idx: number) => run.rubric?.sources.find((s) => s.idx === idx);

  if (test === 'cure') out.push({ id: 'test', tone: 'warn', title: 'This one was set up to fail on purpose', detail: `${name}'s story was written to end with her walking away from her wheelchair, and the writer was told to ignore the rules on the first draft. The point is to see whether the review catches it.` });
  if (test === 'refuse') out.push({ id: 'test', tone: 'warn', title: 'This one was set up to be refused on purpose', detail: 'The writer was told to ignore the rules on every draft. The point is to see whether the studio stops after three tries instead of making the film anyway.' });

  if (run.sources) {
    const adv = run.sources.filter((s) => s.pool === 'advocacy').length;
    out.push({ id: 'rs', tone: 'ok', title: `Found out how kids like ${name} should be shown, from the people who know`, detail: `${run.sources.length} sources. ${adv} are disability groups and writers' style guides, ${run.sources.length - adv} are from the rest of the web.`, body: (
      <details><summary>See the sources</summary>
        <ul>{run.sources.map((s) => <li key={s.idx}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> <span className="src">{s.publisher}{s.pool === 'advocacy' ? ' · advocacy or style guide' : ''}</span></li>)}</ul>
      </details>
    ) });
  }

  if (run.rubric) {
    const r = run.rubric;
    out.push({ id: 'st', tone: 'ok', title: 'Set the rules this story has to keep', detail: `${r.must_do.length + r.must_not_do.length} rules, each one pointing back to where it came from. Three more never change: no miracle cures, no pity, no "so inspiring".`, body: (
      <details><summary>Read the rules</summary>
        <ul>{[...r.must_do, ...r.must_not_do].map((x) => { const s = srcOf(x.source_ref); return <li key={x.id}>{x.rule} {s && <span className="src"><a href={s.url} target="_blank" rel="noreferrer">{s.publisher}</a></span>}</li>; })}</ul>
        {r.avoid_terms.length > 0 && <p className="why" style={{ marginTop: 8 }}>Words kept out of the narration: {r.avoid_terms.join(', ')}.</p>}
      </details>
    ) });
  }

  run.review_history.forEach((rev, i) => {
    const last = i === run.review_history.length - 1;
    const sp = run.screenplay;
    out.push({ id: `d${i}`, title: i === 0 ? 'Wrote the first draft' : `Wrote the ${ORDINAL[i] ?? 'next'} draft, using the notes`, detail: last && sp ? <>&ldquo;{sp.title}&rdquo; {sp.logline}</> : undefined });
    const all = [...rev.deterministic, ...rev.model_scored];
    const failed = all.filter((s) => rev.hard_failures.includes(s.rule_id));
    const tone = rev.verdict === 'PASS' ? 'ok' : rev.verdict === 'REVISE' ? 'warn' : 'bad';
    const title = rev.verdict === 'PASS' ? 'Checked every line. It passed.' : rev.verdict === 'REVISE' ? 'Checked every line. Sent it back.' : 'Checked every line. Stopped.';
    const detail = rev.verdict === 'PASS'
      ? `${all.length} checks, all clear. Every line the reviewer quoted is really in the script.`
      : rev.verdict === 'REVISE'
        ? `${failed.length} of ${all.length} checks failed. The exact lines went back to the writer.`
        : `Still failing ${failed.length} of ${all.length} checks on the third draft. Nothing was drawn or filmed.`;
    out.push({ id: `c${i}`, tone, title, detail, body: (
      <>
        {failed.map((s) => <div key={s.rule_id}><blockquote>{s.evidence || ruleText(s.rule_id, run.rubric)}</blockquote><div className="why">{s.note || ruleText(s.rule_id, run.rubric)}</div></div>)}
        <details><summary>All {all.length} checks</summary>
          <div className="checks">{all.map((s) => <div key={s.rule_id} className="row"><span className={`r ${s.result}`}>{resultWord(s.result)}</span><div>{ruleText(s.rule_id, run.rubric)}{s.evidence && <div className="ev">&ldquo;{s.evidence}&rdquo;</div>}</div></div>)}</div>
        </details>
      </>
    ) });
  });

  if (run.art_brief) {
    out.push({ id: 'ds', tone: 'ok', title: `Made sure ${name} looks like ${name} in every frame`, detail: 'One description, used for every picture.', body: <details><summary>Read it</summary><p className="locked">{run.art_brief.character.locked_description}</p></details> });
  }

  const frames = run.storyboard?.frames.filter((f) => !f.error) ?? [];
  if (frames.length > 0) {
    out.push({ id: 'sb', tone: 'ok', title: 'Drew the storyboard', detail: `${frames.length} frames.`, body: <div className="board">{frames.map((f) => <figure key={f.shot}><img src={fileUrl(run.folder, f.file)} alt={`Frame ${f.shot}`} loading="lazy" /><figcaption>Frame {f.shot}</figcaption></figure>)}</div> });
  }

  if (run.animatic) {
    out.push({ id: 'fm', tone: 'ok', title: 'Filmed it', detail: `${run.render?.clips ?? 8} shots with narration, plus a title card and an end card.`, body: run.render?.narration ? <details><summary>Read the narration</summary><ol>{run.render.narration.map((l, i) => <li key={i}>{l}</li>)}</ol></details> : undefined });
  } else if (run.render?.status === 'error') {
    out.push({ id: 'fm', tone: 'bad', title: 'The film did not get made', detail: run.render.error });
  } else if (run.film_skipped && run.status !== 'running' && run.review?.verdict === 'PASS') {
    out.push({ id: 'fm', title: 'No film yet', detail: cap(run.film_skipped) + '.' });
  }

  if (run.package) {
    out.push({ id: 'dl', tone: 'ok', title: 'Kept everything, untouched', detail: 'Every file this run produced, for anyone who wants to check.', body: (
      <div className="files">
        {run.animatic && <a href={fileUrl(run.folder, run.animatic)} target="_blank" rel="noreferrer">The film</a>}
        {run.package.files.filter((f) => f !== 'screenplay.json').map((f) => <a key={f} href={fileUrl(run.folder, f)} target="_blank" rel="noreferrer">{FILE_LABEL[f] ?? f}</a>)}
      </div>
    ) });
  }

  if (run.status === 'error') out.push({ id: 'err', tone: 'bad', title: 'Something went wrong', detail: run.error });
  return out;
}

function Tiles() {
  return <span className="tiles" aria-hidden="true"><b>H</b><i>F</i><b>S</b></span>;
}

function Play({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 2.2v9.6a.6.6 0 0 0 .9.5l7.4-4.8a.6.6 0 0 0 0-1L4.4 1.7a.6.6 0 0 0-.9.5z" fill="currentColor" /></svg>;
}

function Arrow() {
  return <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7h10M7.5 2.5L12 7l-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Check() {
  return <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5l2.3 2.3L9.5 3.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Face({ b, size }: { b: Bible | undefined; size?: number }) {
  const colour = b?.colour_palette?.[0] ?? '#3d3d3f';
  const style = size ? { background: colour, width: size, height: size } : { background: colour };
  return <span className="face" style={style}>{(b?.name ?? '?').charAt(0)}</span>;
}

export default function Page() {
  const [bibles, setBibles] = useState<Bible[]>([]);
  const [recent, setRecent] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [withFilm, setWithFilm] = useState(true);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [how, setHow] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [featured, setFeatured] = useState<{ id: string; title: string; logline?: string } | null>(null);
  const [wantPlay, setWantPlay] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'split' | 'watch' | 'make'>('split');
  const go = (to: 'watch' | 'make') => { setMode(to); frameRef.current?.scrollTo({ top: 0 }); };

  const loadRecent = () => fetch(`${API}/api/runs`).then((r) => r.json()).then((rs: RunSummary[]) => setRecent([...rs].reverse().filter((r, i, all) => !(r.live && r.status !== 'running' && all.some((o) => !o.live && o.character === r.character && o.title === r.title))))).catch(() => undefined);

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
    const f = recent.find((r) => r.film && r.verdict === 'PASS' && !(r.live && r.status === 'running'));
    if (!f || featured?.id === f.id) return;
    fetch(`${API}/api/runs/${f.id}`).then((r) => r.json()).then((v: RunView) => setFeatured({ id: f.id, title: v.screenplay?.title ?? f.title ?? `${f.character}'s story`, logline: v.screenplay?.logline })).catch(() => setFeatured({ id: f.id, title: f.title ?? `${f.character}'s story` }));
  }, [recent]);

  useEffect(() => {
    if (!runId) { setRun(null); return; }
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`${API}/api/runs/${runId}`);
        if (r.status === 404) { if (!stop) { setError('That link does not point at anything we made.'); setRunId(null); } return; }
        const data = (await r.json()) as RunView;
        if (!stop) { setRun(data); setNow(Date.now()); }
        const working = data.status === 'running' || data.render?.status === 'rendering';
        if (!stop && working) setTimeout(tick, 3000);
      } catch {
        if (!stop) setTimeout(tick, 5000);
      }
    };
    void tick();
    return () => { stop = true; };
  }, [runId]);

  const screen: 'pick' | 'loading' | 'making' | 'result' = !runId ? 'pick' : !run ? 'loading' : run.status === 'running' || run.render?.status === 'rendering' ? 'making' : 'result';

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    v.play().catch(() => undefined);
  }, [screen, mode]);

  useEffect(() => { frameRef.current?.scrollTo({ top: 0 }); }, [screen, runId]);

  useEffect(() => {
    const h = window.location.hash.replace('#', '');
    if (screen === 'pick' && (h === 'watch' || h === 'make')) setMode(h);
  }, [screen]);

  const hero = useMemo(() => (run ? bibles.find((b) => b.name === run.character && !b.adversarial) ?? bibles.find((b) => b.name === run.character) : undefined), [run, bibles]);
  const pickedBible = picked ? bibles.find((b) => b.id === picked) : undefined;
  const test = run ? testKindOfFolder(run.folder) : null;
  const chapters = useMemo(() => (run ? buildChapters(run, hero, test) : []), [run, hero, test]);
  const steps = run ? buildSteps(run, run.character) : [];
  const live = run ? liveLine(run, run.character) : '';
  const startedAt = run?.events[0]?.ts ?? recent.find((r) => r.id === runId)?.started_at;
  const minutes = startedAt ? Math.max(0, Math.floor((now - startedAt) / 60000)) : null;
  const verdict = run?.review?.verdict;
  const finishedFilm = recent.find((r) => r.film && r.verdict === 'PASS' && !r.live);

  const goHome = (to?: 'watch' | 'make') => {
    setRunId(null); setRun(null); setError(null); setHint(null); setWantPlay(false);
    setMode(to ?? 'split');
    frameRef.current?.scrollTo({ top: 0 });
  };

  const open = (id: string, play = false) => { setError(null); setRun(null); setWantPlay(play); setRunId(id); };

  const start = async () => {
    if (!pickedBible) { setHint('Pick a hero first.'); return; }
    setHint(null); setError(null); setBusy(true);
    const { id, ...body } = pickedBible;
    void id;
    const r = await fetch(`${API}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, film: withFilm }) });
    setBusy(false);
    if (!r.ok) { setError(`Could not start. The studio answered ${r.status}.`); return; }
    const { run_id } = (await r.json()) as { run_id: string };
    setPicked(null);
    open(run_id);
  };

  const makeFilm = async () => {
    if (!run?.folder) return;
    setBusy(true);
    const r = await fetch(`${API}/api/runs/${encodeURIComponent(run.folder)}/render`, { method: 'POST' });
    setBusy(false);
    if (!r.ok) { const b = (await r.json().catch(() => ({}))) as { error?: string }; setError(b.error ?? `Could not start the film. The studio answered ${r.status}.`); return; }
    open(run.folder);
  };

  const heroes = bibles.filter((b) => !b.adversarial);
  const tests = bibles.filter((b) => b.adversarial);
  const lastFail = run?.review && run.review.verdict !== 'PASS' ? [...run.review.deterministic, ...run.review.model_scored].find((s) => run.review!.hard_failures.includes(s.rule_id)) : undefined;
  const finished = recent.filter((r) => !(r.live && r.status === 'running'));
  const rows = [
    { title: 'Films', items: finished.filter((r) => r.film && r.verdict === 'PASS') },
    { title: 'Scripts and storyboards', items: finished.filter((r) => !r.film && r.verdict === 'PASS') },
    { title: 'Stopped by the studio', items: finished.filter((r) => r.verdict === 'HALT') },
    { title: 'Making now', items: recent.filter((r) => r.live && r.status === 'running') },
  ];
  const heroOf = (name: string) => bibles.find((b) => b.name === name && !b.adversarial);
  const summaryLabel = (r: RunSummary) => (r.live && r.status === 'running' ? 'Making now' : r.verdict === 'HALT' ? 'Stopped' : r.status === 'error' ? 'Did not finish' : r.film ? 'Film' : 'Script and storyboard');

  return (
    <div className="stage">
      <div className="frame" ref={frameRef}>
        <header className="nav">
          <button className="brand" onClick={() => goHome()} aria-label="Hidden Force Studio home"><Tiles /><span>Hidden Force Studio</span></button>
          <nav className="links">
            <button className="hide-sm" onClick={() => goHome('make')}>Build</button>
            <button className="hide-sm" onClick={() => goHome('watch')}>Watch</button>
            <button onClick={() => setHow(true)}>How it works</button>
            <a className="hide-sm" href={REPO} target="_blank" rel="noreferrer">Code</a>
            {screen !== 'pick' && <button className="cta" onClick={() => goHome()}>Make another</button>}
          </nav>
        </header>

        {screen === 'pick' && (
          <div className={`split mode-${mode}`}>
            <section className="half make" onClick={() => { if (mode !== 'make') go('make'); }}>
              <button className="strip" onClick={(e) => { e.stopPropagation(); go('make'); }}>Build your own</button>
              <div className="half-head">
                <h2 className="wordmark">Build your own</h2>
                <p className="half-sub">Pick a hero. Half an hour later, a film where their ADHD, autism, deafness, anxiety, dyslexia or wheelchair is the reason they win. A script that gets the kid wrong never gets made.</p>
                {mode !== 'make' ? <span className="btn">Start<Arrow /></span> : <button className="btn" onClick={(e) => { e.stopPropagation(); goHome(); }}>Back</button>}
              </div>
              {mode === 'make' && (
                <div className="half-body">
              <div className="card">
                <div>
                  <div className="step-label"><b>1</b> Pick a hero</div>
                  <div className="heroes">
                    {heroes.map((b) => (
                      <button key={b.id} className={`tile${picked === b.id ? ' on' : ''}`} onClick={() => { setPicked(b.id); setHint(null); }}>
                        <Face b={b} />
                        <span className="nm">{b.name}</span>
                        <span className="tr">{b.age} · {b.trait}</span>
                      </button>
                    ))}
                  </div>
                  {tests.length > 0 && (
                    <div className="tests">
                      <span>Want proof it won&rsquo;t get the kid wrong?</span>
                      {tests.map((b) => <button key={b.id} className={picked === b.id ? 'on' : ''} onClick={() => { setPicked(b.id); setHint(null); }}>{testKind(b) === 'refuse' ? 'The refusal test' : 'The cure-story test'}</button>)}
                    </div>
                  )}
                </div>
                <div>
                  <div className="step-label"><b>2</b> Their hidden power</div>
                  {pickedBible ? (
                    <div className={`power${pickedBible.adversarial ? ' test' : ''}`}>
                      {testKind(pickedBible) === 'cure' && <><div className="big">{pickedBible.name} is a wheelchair user, and this story is written to end with her walking.</div><div className="story">That is the oldest mistake in the book. The writer will be told to ignore the rules on the first draft, so you can watch the review catch it and send it back.</div></>}
                      {testKind(pickedBible) === 'refuse' && <><div className="big">{pickedBible.name} again, but the writer ignores the rules on every draft.</div><div className="story">The studio gives a script three tries. After that it stops and makes nothing. This is the test that shows it will.</div></>}
                      {!pickedBible.adversarial && <><div className="big">{pickedBible.name}, {pickedBible.age}, {pickedBible.trait}. {cap(pickedBible.reframe)}.</div><div className="story">The story: {pickedBible.story_premise}.</div></>}
                    </div>
                  ) : (
                    <div className="power empty">Choose a hero above to see their power and their story.</div>
                  )}
                </div>
                <div>
                  <div className="step-label"><b>3</b> Make it</div>
                  <div className="tools">
                    <div className="chips">
                      <button className={`chip${withFilm ? ' on' : ''}`} onClick={() => setWithFilm(true)}>Film <span className="t">ready in about 30 min</span></button>
                      <button className={`chip${!withFilm ? ' on' : ''}`} onClick={() => setWithFilm(false)}>Script and storyboard <span className="t">ready in about 12 min</span></button>
                    </div>
                    <div className="right">
                      <button className={`send${pickedBible ? '' : ' dim'}`} onClick={start} disabled={busy} aria-label={withFilm ? 'Make the film' : 'Write the script'}>
                        {withFilm ? 'Make the film' : 'Write the script'}
                        <span className="ic"><Arrow /></span>
                      </button>
                    </div>
                  </div>
                </div>
                {hint && <div className="hint">{hint}</div>}
                {error && <div className="error">{error}</div>}
              </div>
                </div>
              )}
            </section>

            <section className="half watch" onClick={() => { if (mode !== 'watch') go('watch'); }}>
              <button className="strip" onClick={(e) => { e.stopPropagation(); go('watch'); }}>Watch our films</button>
              <div className="half-head">
                <video ref={videoRef} className="half-video" src="/loop.mp4" poster="/poster.jpg" autoPlay muted loop playsInline preload="auto" aria-hidden="true" />
                <h2 className="wordmark">Watch our films</h2>
                <p className="half-sub">{word(rows[0].items.length)} films and {word(rows[1].items.length).toLowerCase()} stories, made by the studio and left exactly as they came out. {word(rows[2].items.length)} it refused to finish.</p>
                {mode !== 'watch' ? <span className="btn">Watch<Arrow /></span> : <button className="btn" onClick={(e) => { e.stopPropagation(); goHome(); }}>Back</button>}
              </div>
              {mode === 'watch' && (
                <div className="half-body">
              {featured && (
                <div className="featured">
                  <img src={fileUrl(featured.id, 'storyboard/shot_01.jpg')} alt="" />
                  <div className="f-veil" />
                  <div className="f-body">
                    <span className="tag">Newest film</span>
                    <h2>{featured.title}</h2>
                    {featured.logline && <p>{featured.logline}</p>}
                    <div className="f-actions">
                      <button className="send" onClick={() => open(featured.id, true)}>Play<span className="ic"><Play size={12} /></span></button>
                      <button className="ghost" onClick={() => open(featured.id)}>Why it passed</button>
                    </div>
                  </div>
                </div>
              )}
              {rows.map((row) => row.items.length > 0 && (
                <div className="shelf-row" key={row.title}>
                  <h3>{row.title}</h3>
                  <div className="rail">
                    {row.items.map((r) => {
                      const h = heroOf(r.character);
                      return (
                        <button key={r.id} className="tile-f" onClick={() => open(r.id, Boolean(r.film))}>
                          {r.verdict === 'PASS' && !(r.live && r.status === 'running') ? <img src={fileUrl(r.id, 'storyboard/shot_01.jpg')} alt="" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} /> : <div className={`ph${r.verdict === 'HALT' ? ' bad' : r.live && r.status === 'running' ? ' live' : ''}`}>{summaryLabel(r)}</div>}
                          <div className="cap"><div className="tt">{r.title ?? `${r.character}'s story`}</div><div className="ss">{r.character}{h ? `, ${h.age} · ${h.trait}` : ''}</div></div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
                </div>
              )}
            </section>
          </div>
        )}

        {screen === 'loading' && (
          <main className="hero"><div className="card center">Opening&hellip;</div></main>
        )}

        {screen === 'making' && run && (
          <main className="hero">
            <h1 className="h1 title">{run.review?.verdict === 'PASS' && run.screenplay ? run.screenplay.title : `${run.character}'s ${run.film ? 'film' : 'story'} is on its way`}</h1>
            <div className="card">
              <div className="who">
                <Face b={hero} size={38} />
                <div><div className="t1">{live}&hellip;</div><div className="t2">{hero ? `${run.character}, ${hero.age}, ${hero.trait}. ${cap(hero.reframe)}.` : run.character}</div></div>
                {minutes !== null && <div className="clock">{minutes < 1 ? 'Just started' : `${minutes} min in`}</div>}
              </div>
              <ol className="steps">
                {steps.map((s) => <li key={s.key} className={s.state}><span className="ic">{s.state === 'done' ? <Check /> : s.state === 'stopped' ? '×' : null}</span><div>{s.label}{s.sub && <div className="sub">{s.sub}</div>}</div></li>)}
              </ol>
              <p className="note">
                {run.film ? 'The script and storyboard take about 12 minutes, the film another 15 or so.' : 'This takes about 12 minutes.'} You can leave and come back, this link will still be here.
                {finishedFilm && <> Or <button onClick={() => open(finishedFilm.id)}>watch one that&rsquo;s finished</button> while you wait.</>}
              </p>
            </div>
          </main>
        )}

        {screen === 'result' && run && (
          <main className="hero">
            <div className="result-head">
              <span className={`status${verdict === 'PASS' ? ' pass' : verdict === 'HALT' ? ' halt' : ''}`}>{verdict === 'HALT' ? 'Stopped' : run.status === 'error' ? 'Did not finish' : run.animatic ? 'Ready to watch' : 'Ready to read'}</span>
              <h1 className="h1 title">{run.screenplay?.title ?? `${run.character}'s story`}</h1>
              <div className="kicker">{hero ? `${run.character}, ${hero.age}, ${hero.trait}. ${cap(hero.reframe)}.` : run.character}</div>
            </div>
            <div className="card wide">
              {run.animatic && <div className="player"><video controls autoPlay={wantPlay} preload="metadata" src={fileUrl(run.folder, run.animatic)} poster={fileUrl(run.folder, 'storyboard/shot_01.jpg')} /></div>}
              {!run.animatic && verdict === 'PASS' && run.status !== 'error' && (
                <div className="still">
                  <img src={fileUrl(run.folder, 'storyboard/shot_01.jpg')} alt="" />
                  <div className="over">
                    <p>The script and storyboard are done. The film takes about 15 minutes more.</p>
                    <button className="send" onClick={makeFilm} disabled={busy}>Make the film<span className="ic"><Arrow /></span></button>
                    {error && <div className="error">{error}</div>}
                  </div>
                </div>
              )}
              {verdict === 'HALT' && (
                <div className="panel bad">
                  <h3>The studio said no.</h3>
                  <p>Three drafts, three failures. It stopped here and did not draw or film anything.{lastFail?.note ? ` The last one: ${lastFail.note}` : ''}</p>
                  {lastFail?.evidence && <blockquote>{lastFail.evidence}</blockquote>}
                </div>
              )}
              {run.status === 'error' && verdict !== 'HALT' && (
                <div className="panel bad"><h3>Something went wrong.</h3><p>{run.error}</p></div>
              )}
              {run.screenplay && verdict === 'PASS' && <p style={{ color: 'var(--ink-2)' }}>{run.screenplay.logline}</p>}
              <div>
                <div className="sect" style={{ marginBottom: 8 }}>{verdict === 'PASS' ? 'Why it passed' : verdict === 'HALT' ? 'Why it was stopped' : 'What happened'}</div>
                <ol className="story">
                  {chapters.map((c) => (
                    <li key={c.id} className={c.tone ?? ''}>
                      <span className="n">{c.tone === 'ok' ? <Check /> : c.tone === 'bad' ? '×' : c.tone === 'warn' ? '!' : ''}</span>
                      <div>
                        <h4>{c.title}</h4>
                        {c.detail && <div className="d">{c.detail}</div>}
                        {c.body}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="foot-actions">
                <button className="ghost" onClick={() => goHome()}>Make another</button>
                {finishedFilm && finishedFilm.id !== runId && <button className="ghost" onClick={() => open(finishedFilm.id)}>Watch a finished film</button>}
              </div>
            </div>
          </main>
        )}
      </div>

      {how && (
        <div className="sheet" onClick={() => setHow(false)} role="dialog" aria-modal="true">
          <div className="box" onClick={(e) => e.stopPropagation()}>
            <h2>How it works</h2>
            <ol>
              <li>Pick a hero. Six kids whose ADHD, autism, deafness, anxiety, dyslexia or wheelchair is their power, not their problem.</li>
              <li>The studio finds out how that kid should be shown, from disability groups and writers&rsquo; guides, and turns it into rules for this one story.</li>
              <li>It writes the script and checks every line against those rules. A line that breaks one goes back with the reason. Three strikes and nothing gets made.</li>
              <li>What passes gets drawn and filmed. Half an hour, start to finish, and everything it kept is there for you to read.</li>
            </ol>
            <div className="foot"><span>Built on Google Cloud with Gemini, Veo and Parallel Search.</span><a href={REPO} target="_blank" rel="noreferrer">The code</a></div>
          </div>
        </div>
      )}
    </div>
  );
}
