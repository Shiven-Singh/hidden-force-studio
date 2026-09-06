/**
 * Sunday smoke test. One call per candidate model ID and one Parallel search.
 * Run: pnpm --filter hfs-api smoke
 */
import './env.js';
import { CharacterBible } from '@hfs/schemas';
import { smoke } from './clients/gemini.js';
import { fetchGuidance } from './clients/parallel.js';

const CANDIDATES = (process.env.SMOKE_MODELS ?? 'gemini-3.5-flash,gemini-3.1-pro,gemini-3.8-flash,gemini-2.5-pro,gemini-2.5-flash').split(',');

for (const model of CANDIDATES) {
  try {
    const t0 = Date.now();
    const text = await smoke(model.trim());
    console.log(`OK    ${model.padEnd(20)} ${Date.now() - t0}ms  "${text}"`);
  } catch (err) {
    console.log(`FAIL  ${model.padEnd(20)} ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
  }
}

if (process.env.PARALLEL_API_KEY) {
  const bible = CharacterBible.parse({
    name: 'Zayan', pronunciation: 'zay-AAN', age: 9, trait: 'ADHD',
    trait_clinical_name: 'attention deficit hyperactivity disorder',
    reframe: 'his brain sees every possibility at once',
    physical_description: 'smoke test', strengths: ['a', 'b'], vulnerabilities: ['c'],
    fear_carried_in: 'smoke test', story_premise: 'smoke test', colour_palette: ['#E4572E'], totem: 'rubber band',
  });
  const t0 = Date.now();
  const { searchIds, sources } = await fetchGuidance(bible);
  console.log(`OK    parallel             ${Date.now() - t0}ms  ${sources.length} sources, ids ${searchIds.join(', ')}`);
  for (const s of sources.slice(0, 6)) console.log(`      [${s.pool}] ${s.publisher}  ${s.title.slice(0, 70)}`);
} else {
  console.log('SKIP  parallel             PARALLEL_API_KEY not set');
}
