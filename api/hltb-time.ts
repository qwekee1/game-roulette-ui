import type { VercelRequest, VercelResponse } from '@vercel/node';

type RawSearchItem = Record<string, unknown>;

type ParsedResult = {
  title: string;
  main: number | null;
  mainExtra: number | null;
  completionist: number | null;
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

function valueAsString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function valueAsNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function secondsToHours(seconds: number | null): number | null {
  if (seconds == null || seconds <= 0) return null;
  return Math.round((seconds / 3600) * 10) / 10;
}

function toDisplayText(hours: number | null | undefined): string | null {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return null;
  return Number.isInteger(hours) ? `${hours} ч` : `${hours.toFixed(1)} ч`;
}

function parseSearchItem(item: RawSearchItem): ParsedResult | null {
  const title =
    valueAsString(item.game_name) ||
    valueAsString(item.gameName) ||
    valueAsString(item.name) ||
    valueAsString(item.title);

  if (!title) return null;

  const compMainSeconds =
    valueAsNumber(item.comp_main) ??
    valueAsNumber(item.gameplayMain) ??
    valueAsNumber(item.main);

  const compPlusSeconds =
    valueAsNumber(item.comp_plus) ??
    valueAsNumber(item.gameplayMainExtra) ??
    valueAsNumber(item.mainExtra);

  const comp100Seconds =
    valueAsNumber(item.comp_100) ??
    valueAsNumber(item.gameplayCompletionist) ??
    valueAsNumber(item.completionist);

  const main = secondsToHours(compMainSeconds);
  const mainExtra = secondsToHours(compPlusSeconds);
  const completionist = secondsToHours(comp100Seconds);

  if (main == null && mainExtra == null && completionist == null) return null;

  return {
    title,
    main,
    mainExtra,
    completionist,
  };
}

function collectResults(payload: unknown): ParsedResult[] {
  const rawArrays: unknown[] = [];

  if (Array.isArray(payload)) {
    rawArrays.push(payload);
  } else if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;

    if (Array.isArray(obj.data)) rawArrays.push(obj.data);
    if (Array.isArray(obj.results)) rawArrays.push(obj.results);
    if (Array.isArray(obj.games)) rawArrays.push(obj.games);

    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) rawArrays.push(value);
    }
  }

  const parsed: ParsedResult[] = [];

  for (const arr of rawArrays) {
    for (const entry of arr as unknown[]) {
      if (!entry || typeof entry !== 'object') continue;
      const result = parseSearchItem(entry as RawSearchItem);
      if (result) parsed.push(result);
    }
  }

  const deduped = new Map<string, ParsedResult>();
  for (const item of parsed) {
    const key = `${normalizeTitle(item.title)}|${item.main ?? ''}|${item.mainExtra ?? ''}|${item.completionist ?? ''}`;
    if (!deduped.has(key)) deduped.set(key, item);
  }

  return [...deduped.values()];
}

function scoreResult(result: ParsedResult, query: string): number {
  const q = normalizeTitle(query);
  const t = normalizeTitle(result.title);

  let score = 0;

  if (t === q) score += 100;
  if (t.includes(q)) score += 40;
  if (q.includes(t)) score += 20;

  const qWords = q.split(' ').filter(Boolean);
  const tWords = t.split(' ').filter(Boolean);

  for (const word of qWords) {
    if (tWords.includes(word)) score += 5;
  }

  if (result.main != null) score += 5;
  if (result.mainExtra != null) score += 3;
  if (result.completionist != null) score += 2;

  return score;
}

async function searchHltb(query: string): Promise<ParsedResult[]> {
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
      users: {
        sortCategory: 'postcount',
      },
      filter: '',
      sort: 0,
      randomizer: 0,
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

  if (!response.ok) {
    throw new Error(`HLTB search failed with ${response.status}`);
  }

  const json = await response.json();
  return collectResults(json);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawTitle = Array.isArray(req.query.title) ? req.query.title[0] : req.query.title;

  if (!rawTitle || typeof rawTitle !== 'string' || !rawTitle.trim()) {
    return res.status(200).json({ displayText: '14' });
  }

  const title = rawTitle.trim();

  try {
    const variants = buildSearchVariants(title);
    let allResults: ParsedResult[] = [];

    for (const variant of variants) {
      const results = await searchHltb(variant);
      allResults = allResults.concat(results);
      if (results.length > 0) break;
    }

    if (allResults.length === 0) {
      return res.status(200).json({ displayText: '14' });
    }

    const best = [...allResults].sort((a, b) => scoreResult(b, title) - scoreResult(a, title))[0];

    const displayText =
      toDisplayText(best.main) ??
      toDisplayText(best.mainExtra) ??
      toDisplayText(best.completionist) ??
      '14';

    return res.status(200).json({
      displayText,
      matchedTitle: best.title,
    });
  } catch {
    return res.status(200).json({ displayText: '14' });
  }
}
