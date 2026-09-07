#!/usr/bin/env node
/**
 * Drive one bible through a running hfs-api and print stage progress.
 * Usage: node scripts/run-bible.mjs bibles/zayan.json [http://localhost:8080]
 */
import { readFile } from 'node:fs/promises';

const [file, base = 'http://localhost:8080'] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/run-bible.mjs <bible.json> [api base]');
  process.exit(2);
}

const bible = JSON.parse(await readFile(file, 'utf8'));
const started = Date.now();
const res = await fetch(`${base}/api/runs`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(bible),
});
if (!res.ok) {
  console.error('start failed', res.status, await res.text());
  process.exit(1);
}
const { run_id } = await res.json();
console.log(`run ${run_id} for ${bible.name}${bible.adversarial ? ' (adversarial)' : ''}`);

let last = '';
let seenReviews = 0;
let failures = 0;
for (;;) {
  let r;
  try {
    r = await (await fetch(`${base}/api/runs/${run_id}`, { signal: AbortSignal.timeout(20_000) })).json();
    if (!r || !r.status || !Array.isArray(r.review_history)) throw new Error(`unexpected answer: ${JSON.stringify(r).slice(0, 120)}`);
    failures = 0;
  } catch (err) {
    // The run continues server-side; a dropped poll is not a failed run.
    if (++failures > 30) { console.error('poll failed 30 times, giving up:', err.message); process.exit(1); }
    await new Promise((f) => setTimeout(f, 6000));
    continue;
  }
  const t = ((Date.now() - started) / 1000).toFixed(0).padStart(4);
  if (r.current !== last) {
    console.log(`${t}s  ${r.current}`);
    last = r.current;
  }
  for (const rep of r.review_history.slice(seenReviews)) {
    console.log(`${t}s  gate ${rep.revision_colour}: ${rep.verdict}` +
      (rep.hard_failures.length ? `  hard=[${rep.hard_failures.join(', ')}]` : '') +
      (rep.evidence_unverified.length ? `  unverified=[${rep.evidence_unverified.join(', ')}]` : ''));
    seenReviews += 1;
  }
  if (r.status !== 'running') {
    console.log(`${t}s  ${r.status}${r.error ? `: ${r.error}` : ''}`);
    if (r.sources) console.log(`sources: ${r.sources.length} (${r.sources.filter((s) => s.pool === 'advocacy').length} advocacy)`);
    if (r.rubric) console.log(`rubric: ${r.rubric.must_do.length} must-do, ${r.rubric.must_not_do.length} must-not, avoid=[${r.rubric.avoid_terms.join(', ')}]`);
    if (r.art_brief) console.log(`art brief: ${r.art_brief.shots.length} shots, hash ${r.art_brief.consistency_hash.slice(0, 12)}…`);
    if (r.package) console.log(`package: ${r.package.folder}\n  ${r.package.files.join(', ')}`);
    process.exit(r.status === 'done' ? 0 : 1);
  }
  await new Promise((f) => setTimeout(f, 4000));
}
