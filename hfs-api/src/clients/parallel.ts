/**
 * Parallel Search API, stage 2. This is the partner-service call the rules ask
 * to see "imported and actually called". Two searches per run: one restricted
 * to advocacy and style-guide domains for the trait, one open web. Both pools
 * are labelled so the rubric and the UI can show which rules rest on which.
 */
import Parallel from 'parallel-web';
import type { CharacterBible, Source } from '@hfs/schemas';

let client: Parallel | undefined;
/** Constructed on first use so the server boots without the key; the research stage then fails loudly instead. */
function parallel(): Parallel {
  if (!process.env.PARALLEL_API_KEY) throw new Error('PARALLEL_API_KEY is not set; stage 2 cannot run');
  client ??= new Parallel({ apiKey: process.env.PARALLEL_API_KEY });
  return client;
}

export const ADVOCACY_DOMAINS: Record<string, string[]> = {
  ADHD: ['chadd.org', 'additudemag.com', 'ncdj.org'],
  autistic: ['autisticadvocacy.org', 'autism.org.uk', 'ncdj.org'],
  dyslexia: ['dyslexiaida.org', 'bdadyslexia.org.uk', 'ncdj.org'],
  'wheelchair user': ['respectability.org', 'ncdj.org', 'disabilityin.org'],
  deaf: ['nad.org', 'wfdeaf.org', 'ncdj.org'],
  anxiety: ['adaa.org', 'childmind.org', 'ncdj.org'],
};

type Pool = Source['pool'];

async function search(bible: CharacterBible, includeDomains?: string[]) {
  return parallel().search({
    objective:
      `Current guidance from disability and neurodiversity advocacy organisations on portraying ` +
      `a child with ${bible.trait_clinical_name} in fiction for ages 6 to 9. ` +
      `Prefer style guides and representation guidelines over news.`,
    search_queries: [
      `${bible.trait} representation children media guidelines`,
      `${bible.trait} portrayal fiction do and don't`,
      `disability language style guide ${bible.trait}`,
      `${bible.trait_clinical_name} harmful tropes children stories`,
    ],
    mode: 'advanced',
    advanced_settings: {
      max_results: 8,
      excerpt_settings: { max_chars_per_result: 1500 },
      ...(includeDomains ? { source_policy: { include_domains: includeDomains } } : {}),
    },
  });
}

export interface Guidance {
  searchIds: string[];
  sources: Source[];
}

/** One fetch per trait per day. Six characters share six traits. */
const cache = new Map<string, Guidance>();

export async function fetchGuidance(bible: CharacterBible): Promise<Guidance> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${bible.trait}:${today}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const sources: Source[] = [];
  const searchIds: string[] = [];
  const pools: Array<[Pool, string[] | undefined]> = [
    ['advocacy', ADVOCACY_DOMAINS[bible.trait]],
    ['general', undefined],
  ];

  for (const [pool, domains] of pools) {
    const res = await search(bible, domains);
    searchIds.push(res.search_id);
    for (const r of res.results) {
      sources.push({
        idx: sources.length,
        title: r.title ?? r.url,
        url: r.url,
        publisher: new URL(r.url).hostname.replace(/^www\./, ''),
        publish_date: r.publish_date ?? null,
        retrieved: today,
        excerpt: r.excerpts.join(' ').slice(0, 1500),
        pool,
      });
    }
  }

  const guidance = { searchIds, sources };
  cache.set(key, guidance);
  return guidance;
}
