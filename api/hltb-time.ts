import type { VercelRequest, VercelResponse } from '@vercel/node';

type PublicApiResult = {
  title?: string;
  times?: {
    main?: number | null;
    mainExtra?: number | null;
    completionist?: number | null;
    allStyles?: number | null;
  };
};

type DirectSearchItem = Record<string, unknown>;

type Candidate = {
  title: string;
  main: number | null;
  mainExtra: number | null;
  completionist: number | null;
  source: string;
};

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(game of the year|goty|definitive edition|complete edition|remastered|redux|enhanced edition|director s cut|ultimate edition|collection)\b/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function buildSearchVariants(title: string): string[] {
  const base = title.trim();
  const normalized = normalizeTitle(base);
  const noArticles = normalized.replace(/\b(the|a|an)\b/gu, ' ').replace(/\s+/g, ' ').trim();
  const colonCut = base.split(':')[0]?.trim() ?? '';
  const dashCut = base.split('-')[0]?.trim() ?? '';

  return uniqueStrings([base, normalized, noArticles, colonCut, dashCut]);
}

function toDisplayText(hours: number | null | undefined): string | null {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return null;

  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} ч` : `${rounded.toFixed(1)} ч`;
}

function secondsToHours(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round((value / 3600) * 10) / 10;
}

function hoursValue(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 10) / 10;
}

function scoreCandidate(candidate: Candidate, query: string): number {
  const q = normalizeTitle(query);
  const t = normalizeTitle(candidate.title);

  let score = 0;

  if (!t) return -1;

  if (t === q) score += 100;
  if (t.includes(q)) score += 40;
  if (q.includes(t)) score += 20;

  const qWords = q.split(' ').filter(Boolean);
  const tWords = t.split(' ').filter(Boolean);

  for (const word of qWords) {
    if (tWords.includes(word)) score += 5;
  }

  if (candidate.main != null) score += 5;
  if (candidate.mainExtra != null) score += 3;
  if (candidate.completionist != null) score += 2;

  return score;
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const map = new Map<string, Candidate>();

  for (const candidate of candidates) {
    const key = `${normalizeTitle(candidate.title)}|${candidate.main ?? ''}|${candidate.mainExtra ?? ''}|${candidate.completionist ?? ''}`;
    if (!map.has(key)) {
      map.set(key, candidate);
    }
  }

  return [...map.values()];
}

function parsePublicApiResults(payload: unknown, source: string): Candidate[] {
  const results: Candidate[] = [];

  if (!payload || typeof payload !== 'object') return results;

  const root = payload as { results?: PublicApiResult[] };
  const items = Array.isArray(root.results) ? root.results : [];

  for (const item of items) {
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title) continue;

    const main = hoursValue(item.times?.main);
    const mainExtra = hoursValue(item.times?.mainExtra);
    const completionist = hoursValue(item.times?.completionist);

    if (main == null && mainExtra == null && completionist == null) continue;

    results.push({
      title,
      main,
      mainExtra,
      completionist,
      source,
    });
  }

  return results;
}

function parseDirectItem(item: DirectSearchItem, source: string): Candidate | null {
  const title =
    (typeof item.game_name === 'string' && item.game_name.trim()) ||
    (typeof item.gameName === 'string' && item.gameName.trim()) ||
    (typeof item.title === 'string' && item.title.trim()) ||
    (typeof item.name === 'string' && item.name.trim()) ||
    '';

  if (!title) return null;

  const main =
    secondsToHours(item.comp_main) ??
    secondsToHours(item.gameplayMain) ??
    hoursValue(item.main);

  const mainExtra =
    secondsToHours(item.comp_plus) ??
    secondsToHours(item.gameplayMainExtra) ??
    hoursValue(item.mainExtra);

  const completionist =
    secondsToHours(item.comp_100) ??
    secondsToHours(item.gameplayCompletionist) ??
    hoursValue(item.completionist);

  if (main == null && mainExtra == null && completionist == null) return null;

  return {
    title,
    main,
    mainExtra,
    completionist,
    source,
  };
}

function collectDirectResults(payload: unknown, source: string): Candidate[] {
  const found: Candidate[] = [];

  const walk = (value: unknown) => {
    if (!value) return;

    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }

    if (typeof value !== 'object') return;

    const obj = value as Record<string, unknown>;
    const candidate = parseDirectItem(obj, source);
    if (candidate) found.push(candidate);

    for (const child of Object.values(obj)) {
      if (child && typeof child === 'object') walk(child);
    }
  };

  walk(payload);
  return found;
}

async function searchViaPublicApi(query: string): Promise<Candidate[]> {
  try {
    const response = await fetch(`https://htlb.berkankutuk.dk/api/search?q=${encodeURIComponent(query)}`, {
      headers: {
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0',
      },
    });

    if (!response.ok) return [];

    const json = await response.json();
    return parsePublicApiResults(json, `public:${query}`);
  } catch {
    return [];
  }
}

async function searchViaDirectPost(query: string): Promise<Candidate[]> {
  try {
    const payload = {
      searchType: 'games',
      searchTerms: query.split(/\s+/).filter(Boolean),
      searchPage: 1,
      size: 20,
      searchOptions: {
        games: {
          userId: 0,
          platform: '',
          sortCategory: 'popular',
          rangeCategory: 'main',
          rangeTime: {
            min: 0,
            max: 0,
          },
          gameplay: {
            perspective: '',
            flow: '',
            genre: '',
          },
          modifier: '',
        },
      },
    };

    const response = await fetch('https://howlongtobeat.com/api/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/plain, */*',
        origin: 'https://howlongtobeat.com',
        referer: 'https://howlongtobeat.com/',
        'user-agent': 'Mozilla/5.0',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) return [];

    const json = await response.json();
    return collectDirectResults(json, `direct:${query}`);
  } catch {
    return [];
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawTitle = Array.isArray(req.query.title) ? req.query.title[0] : req.query.title;
  const debug = Array.isArray(req.query.debug) ? req.query.debug[0] : req.query.debug;

  if (!rawTitle || typeof rawTitle !== 'string' || !rawTitle.trim()) {
    return res.status(200).json({ displayText: '14' });
  }

  const title = rawTitle.trim();

  try {
    const variants = buildSearchVariants(title);
    let candidates: Candidate[] = [];

    for (const variant of variants) {
      const [publicResults, directResults] = await Promise.all([
        searchViaPublicApi(variant),
        searchViaDirectPost(variant),
      ]);

      candidates = candidates.concat(publicResults, directResults);

      if (candidates.length > 0) {
        const deduped = dedupeCandidates(candidates);
        const best = [...deduped].sort((a, b) => scoreCandidate(b, title) - scoreCandidate(a, title))[0];
        const bestScore = scoreCandidate(best, title);

        if (bestScore >= 100) {
          const displayText =
            toDisplayText(best.main) ??
            toDisplayText(best.mainExtra) ??
            toDisplayText(best.completionist) ??
            '14';

          return res.status(200).json({
            displayText,
            ...(debug === '1'
              ? {
                  matchedTitle: best.title,
                  main: best.main,
                  mainExtra: best.mainExtra,
                  completionist: best.completionist,
                  source: best.source,
                }
              : {}),
          });
        }
      }
    }

    const deduped = dedupeCandidates(candidates);
    if (deduped.length === 0) {
      return res.status(200).json({ displayText: '14' });
    }

    const best = [...deduped].sort((a, b) => scoreCandidate(b, title) - scoreCandidate(a, title))[0];

    const displayText =
      toDisplayText(best.main) ??
      toDisplayText(best.mainExtra) ??
      toDisplayText(best.completionist) ??
      '14';

    return res.status(200).json({
      displayText,
      ...(debug === '1'
        ? {
            matchedTitle: best.title,
            main: best.main,
            mainExtra: best.mainExtra,
            completionist: best.completionist,
            source: best.source,
          }
        : {}),
    });
  } catch {
    return res.status(200).json({ displayText: '14' });
  }
}
