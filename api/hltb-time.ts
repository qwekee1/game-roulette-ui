import type { VercelRequest, VercelResponse } from '@vercel/node';

type SearchResult = {
  title?: string;
  times?: {
    main?: number | null;
    mainExtra?: number | null;
    completionist?: number | null;
    allStyles?: number | null;
  };
};

type SearchResponse = {
  query?: string;
  results?: SearchResult[];
};

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreResult(result: SearchResult, query: string): number {
  const normalizedQuery = normalizeTitle(query);
  const normalizedTitle = normalizeTitle(result.title ?? '');

  let score = 0;

  if (!normalizedTitle) return score;

  if (normalizedTitle === normalizedQuery) score += 100;
  if (normalizedTitle.includes(normalizedQuery)) score += 40;
  if (normalizedQuery.includes(normalizedTitle)) score += 20;

  const queryWords = normalizedQuery.split(' ').filter(Boolean);
  const titleWords = normalizedTitle.split(' ').filter(Boolean);

  for (const word of queryWords) {
    if (titleWords.includes(word)) score += 5;
  }

  if (result.times?.main != null) score += 3;
  if (result.times?.mainExtra != null) score += 2;
  if (result.times?.completionist != null) score += 1;

  return score;
}

function toDisplayText(hours: number | null | undefined): string | null {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return null;

  const rounded = Math.round(hours * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded} ч`;
  return `${rounded.toFixed(1)} ч`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawTitle = Array.isArray(req.query.title) ? req.query.title[0] : req.query.title;

  if (!rawTitle || typeof rawTitle !== 'string') {
    return res.status(200).json({ displayText: '14' });
  }

  const title = rawTitle.trim();
  if (!title) {
    return res.status(200).json({ displayText: '14' });
  }

  try {
    const upstreamUrl = `https://htlb.berkankutuk.dk/api/search?q=${encodeURIComponent(title)}`;

    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0',
      },
    });

    if (!upstreamResponse.ok) {
      return res.status(200).json({ displayText: '14' });
    }

    const data = (await upstreamResponse.json()) as SearchResponse;
    const results = Array.isArray(data.results) ? data.results : [];

    if (results.length === 0) {
      return res.status(200).json({ displayText: '14' });
    }

    const best = [...results].sort((a, b) => scoreResult(b, title) - scoreResult(a, title))[0];

    const displayText =
      toDisplayText(best.times?.main) ??
      toDisplayText(best.times?.mainExtra) ??
      toDisplayText(best.times?.completionist) ??
      toDisplayText(best.times?.allStyles) ??
      '14';

    return res.status(200).json({
      displayText,
      matchedTitle: best.title ?? null,
    });
  } catch {
    return res.status(200).json({ displayText: '14' });
  }
}
