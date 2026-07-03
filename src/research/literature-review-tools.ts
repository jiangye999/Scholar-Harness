export interface DoiVerificationResult {
  ok: boolean | null;
  title?: string;
  year?: number;
  journal?: string;
  retracted?: boolean | null;
  registry?: 'crossref' | 'non-crossref';
  error?: string;
}

export interface CrossrefLookupResult {
  doi?: string;
  title?: string;
  year?: number;
  score?: number;
}

export interface OpenAlexWorkHit {
  doi: string;
  title?: string;
  year?: number;
  citedBy?: number;
  venue?: string;
  oaUrl?: string;
}

export interface CitationExpansionResult {
  doi: string;
  references: OpenAlexWorkHit[];
  citedBy: OpenAlexWorkHit[];
}

export interface StylePassIssue {
  code: 'EMDASH' | 'HONEST' | 'PROCNOTE' | 'PARENDOI' | 'LONGHEAD' | 'FLATSTRUCT';
  note: string;
}

export interface StylePassResult {
  ok: boolean;
  issues: StylePassIssue[];
}

const DOI_PATTERN = /10\.\d{4,9}\/[^\s"'`\]\}—–&|]+/g;
const DEFAULT_TIMEOUT_MS = 12_000;
const LIT_REVIEW_USER_AGENT = 'ScholarHarness-literature-review/1.0';

export function extractDois(text: string): string[] {
  const decoded = htmlDecode(String(text || ''));
  const out = new Set<string>();
  for (const match of decoded.match(DOI_PATTERN) || []) {
    let doi = match.split('</')[0];
    if ((doi.match(/</g) || []).length !== (doi.match(/>/g) || []).length) {
      doi = doi.split('<')[0];
    }
    doi = doi.replace(/(?:\*\*|__|[_\]\*>`,;:])+$/g, '');
    if (doi.endsWith('.')) doi = doi.slice(0, -1);
    while (doi.endsWith(')') && countChar(doi, '(') < countChar(doi, ')')) {
      doi = doi.slice(0, -1);
    }
    if (doi.length > 8) out.add(doi);
  }
  return Array.from(out).sort();
}

export async function verifyDois(
  dois: string[],
  options: { timeoutMs?: number; maxDois?: number } = {}
): Promise<Record<string, DoiVerificationResult>> {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const uniqueDois = Array.from(new Set(dois.map(doi => doi.trim()).filter(Boolean))).slice(0, options.maxDois || 80);
  const out: Record<string, DoiVerificationResult> = {};

  for (const doi of uniqueDois) {
    const decodedSegments = decodeURIComponentSafe(doi).split('/');
    if (decodedSegments.slice(1).some(segment => segment === '' || segment === '.' || segment === '..')) {
      out[doi] = { ok: false, error: 'dot-segment in DOI' };
      continue;
    }

    const encoded = quoteDoiPath(doi);
    const crossref = await getJsonWithRetry(`https://api.crossref.org/works/${encoded}`, timeoutMs);
    const message = crossref && typeof crossref === 'object' ? (crossref as { message?: Record<string, unknown> }).message : undefined;
    if (message) {
      const title = firstStringArrayValue(message.title);
      const updateTypes = Array.isArray(message['update-to'])
        ? (message['update-to'] as Array<Record<string, unknown>>).map(item => String(item.type || ''))
        : [];
      const retracted = updateTypes.some(type => type.toLowerCase().includes('retract'))
        || String(message.subtype || '').toLowerCase() === 'retraction'
        || title.toUpperCase().startsWith('RETRACTED');
      out[doi] = {
        ok: true,
        title,
        year: crossrefYear(message),
        journal: firstStringArrayValue(message['container-title']),
        retracted,
        registry: 'crossref',
      };
      await sleep(60);
      continue;
    }

    const doiOrgStatus = await headStatusNoRedirect(`https://doi.org/${encoded}`, timeoutMs);
    if (doiOrgStatus !== null && doiOrgStatus >= 200 && doiOrgStatus < 400) {
      out[doi] = { ok: true, registry: 'non-crossref', retracted: null };
    } else if (doiOrgStatus === 404) {
      out[doi] = { ok: false };
    } else {
      out[doi] = { ok: null, error: 'unverified (network)', retracted: null };
    }
  }

  return out;
}

export async function crossrefLookup(refString: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CrossrefLookupResult | null> {
  const query = encodeURIComponent(refString);
  const json = await getJsonWithRetry(`https://api.crossref.org/works?query.bibliographic=${query}&rows=1`, timeoutMs);
  const items = ((json as { message?: { items?: Record<string, unknown>[] } } | null)?.message?.items || []);
  const item = items[0];
  if (!item) return null;
  return {
    doi: typeof item.DOI === 'string' ? item.DOI : undefined,
    title: firstStringArrayValue(item.title),
    year: crossrefYear(item),
    score: typeof item.score === 'number' ? item.score : undefined,
  };
}

export async function searchOpenAlex(
  query: string,
  n = 10,
  filters = '',
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<OpenAlexWorkHit[]> {
  const encodedQuery = encodeURIComponent(query);
  const filter = filters ? `&filter=${encodeURIComponent(filters)}` : '';
  const url = `https://api.openalex.org/works?search=${encodedQuery}&per-page=${Math.min(n, 25)}&sort=cited_by_count:desc${filter}`;
  const json = await getJsonWithRetry(url, timeoutMs);
  const results = ((json as { results?: Record<string, unknown>[] } | null)?.results || []).slice(0, n);
  return results.map(openAlexWorkToHit);
}

export async function expandCitations(
  doi: string,
  nBackward = 50,
  nForward = 15,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<CitationExpansionResult> {
  const encoded = quoteDoiPath(doi);
  const work = await getJsonWithRetry(`https://api.openalex.org/works/doi:${encoded}?select=id`, timeoutMs);
  const rawId = String((work as { id?: unknown } | null)?.id || '');
  const workId = rawId.split('/').pop();
  if (!workId) {
    return { doi, references: [], citedBy: [] };
  }

  const list = async (filterExpr: string, n: number): Promise<OpenAlexWorkHit[]> => {
    const url = [
      'https://api.openalex.org/works?',
      `filter=${encodeURIComponent(filterExpr)}`,
      '&select=doi,title,publication_year,cited_by_count,primary_location,open_access',
      '&sort=cited_by_count:desc',
      `&per-page=${Math.min(n, 100)}`,
    ].join('');
    const json = await getJsonWithRetry(url, timeoutMs);
    return ((json as { results?: Record<string, unknown>[] } | null)?.results || []).map(openAlexWorkToHit);
  };

  return {
    doi,
    references: await list(`cited_by:${workId}`, nBackward),
    citedBy: await list(`cites:${workId}`, nForward),
  };
}

export function stylePass(draft: string): StylePassResult {
  const issues: StylePassIssue[] = [];
  const wordCount = draft.split(/\s+/).filter(Boolean).length || 1;
  const emDashCount = countChar(draft, '—');
  if (emDashCount > 6 && (1000 * emDashCount) / wordCount > 8) {
    issues.push({
      code: 'EMDASH',
      note: `${emDashCount} em-dashes (${Math.round((1000 * emDashCount) / wordCount)}/1kw); replace most with comma/colon/period, keep at most one per paragraph`,
    });
  }
  const honest = draft.match(/\b(the\s+|an?\s+)?honest(ly)?\s+(answer|summary|read|reading|look|perspective|assessment|appraisal|take|view)\b/i);
  if (honest) {
    issues.push({ code: 'HONEST', note: `${JSON.stringify(honest[0])}: drop the framing, write the sentence it was guarding` });
  }
  if (/(DOIs?\s+(were\s+)?verif|verified against (CrossRef|PubMed)|no retraction|current as of)/i.test(draft)) {
    issues.push({ code: 'PROCNOTE', note: 'process-narration line present; delete it' });
  }
  if (/\]\(https:\/\/doi\.org\/[^)\s]*\([^)\s]*\)/.test(draft)) {
    issues.push({ code: 'PARENDOI', note: 'DOI href contains literal ( ); URL-encode as %28 %29 so the markdown link survives simpler renderers' });
  }
  const h2 = draft.split('\n').filter(line => line.startsWith('## '));
  const longH2 = h2.filter(line => line.split(/\s+/).filter(Boolean).length > 8);
  if (longH2.length >= 2) {
    issues.push({ code: 'LONGHEAD', note: `${longH2.length} headings read as sentences; shorten to <=6-word noun phrases` });
  }
  if (h2.length >= 7 && !draft.split('\n').some(line => line.startsWith('### '))) {
    issues.push({ code: 'FLATSTRUCT', note: `${h2.length} top-level sections, no subsections; group related ## under a parent and demote to ###` });
  }
  return { ok: issues.length === 0, issues };
}

function openAlexWorkToHit(work: Record<string, unknown>): OpenAlexWorkHit {
  const primaryLocation = (work.primary_location || {}) as { source?: { display_name?: string } };
  const openAccess = (work.open_access || {}) as { oa_url?: string };
  return {
    doi: String(work.doi || '').replace('https://doi.org/', ''),
    title: typeof work.title === 'string' ? work.title : undefined,
    year: typeof work.publication_year === 'number' ? work.publication_year : undefined,
    citedBy: typeof work.cited_by_count === 'number' ? work.cited_by_count : undefined,
    venue: primaryLocation.source?.display_name,
    oaUrl: openAccess.oa_url,
  };
}

async function getJsonWithRetry(url: string, timeoutMs: number): Promise<unknown | null> {
  for (const attempt of [0, 1]) {
    try {
      const response = await fetchWithTimeout(url, { method: 'GET' }, timeoutMs);
      if (response.status === 429 && attempt === 0) {
        await sleep(2000);
        continue;
      }
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }
  return null;
}

async function headStatusNoRedirect(url: string, timeoutMs: number): Promise<number | null> {
  for (const attempt of [0, 1]) {
    try {
      const response = await fetchWithTimeout(url, { method: 'HEAD', redirect: 'manual' }, timeoutMs);
      if (response.status === 429 && attempt === 0) {
        await sleep(2000);
        continue;
      }
      return response.status;
    } catch {
      return null;
    }
  }
  return null;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': LIT_REVIEW_USER_AGENT,
        ...(init.headers || {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function quoteDoiPath(doi: string): string {
  return doi
    .split('/')
    .map(segment => encodeURIComponent(decodeURIComponentSafe(segment)))
    .join('/');
}

function crossrefYear(message: Record<string, unknown>): number | undefined {
  const published = (message.published || {}) as { 'date-parts'?: unknown };
  const dateParts = published['date-parts'];
  if (!Array.isArray(dateParts) || !Array.isArray(dateParts[0])) return undefined;
  const year = Number(dateParts[0][0]);
  return Number.isFinite(year) ? year : undefined;
}

function firstStringArrayValue(value: unknown): string {
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : '';
}

function htmlDecode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x2F;/g, '/')
    .replace(/&#47;/g, '/');
}

function countChar(value: string, char: string): number {
  return value.split(char).length - 1;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
