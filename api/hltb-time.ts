import type { VercelRequest, VercelResponse } from '@vercel/node';

type Candidate = {
  title: string;
  main: number | null;
  mainExtra: number | null;
  completionist: number | null;
};

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeTitle(value: string): string {
  return normalizeSpaces(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\b(game of the year|goty|definitive edition|complete edition|remastered|redux|enhanced edition|director s cut|ultimate edition|collection)\b/gu, ' ')
      .replace(/\s+/g, ' '),
  );
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

function scoreCandidate(candidate: Candidate, query: string): number {
  const q = normalizeTitle(query);
  const t = normalizeTitle(candidate.title);

  if (!t) return -1;

  let score = 0;

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

function parseHourText(value: string): number | null {
  const text = normalizeSpaces(decodeHtml(value));

  const patterns = [
    /(\d+(?:\.\d+)?)\s*(?:Hours|Hour|Hrs|Hr)\b/i,
    /(\d+(?:\.\d+)?)\s*(?:Mins|Min)\b/i,
  ];

  const hourMatch = text.match(patterns[0]);
  if (hourMatch?.[1]) {
    const hours = Number(hourMatch[1]);
    if (Number.isFinite(hours) && hours > 0) return hours;
  }

  const minMatch = text.match(patterns[1]);
  if (minMatch?.[1]) {
    const mins = Number(minMatch[1]);
    if (Number.isFinite(mins) && mins > 0) return Math.round((mins / 60) * 10) / 10;
  }

  return null;
}

function stripTags(html: string): string {
  return normalizeSpaces(decodeHtml(html.replace(/<[^>]+>/g, ' ')));
}

function extractCellValue(rowHtml: string): number | null {
  const strongMatch = rowHtml.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i);
  if (strongMatch?.[1]) {
    const parsed = parseHourText(strongMatch[1]);
    if (parsed != null) return parsed;
  }

  const plain = stripTags(rowHtml);
  return parseHourText(plain);
}

function extractLabel(rowHtml: string): string {
  const plain = stripTags(rowHtml);
  return normalizeTitle(plain);
}

function parseCandidatesFromHtml(html: string): Candidate[] {
  const decodedHtml = decodeHtml(html);
  const candidates: Candidate[] = [];

  const gameBlocks =
    decodedHtml.match(/<li[^>]*class="[^"]*back_darkish[^"]*"[\s\S]*?<\/li>/gi) ??
    decodedHtml.match(/<li[\s\S]*?<\/li>/gi) ??
    [];

  for (const block of gameBlocks) {
    const titleMatch =
      block.match(/<a[^>]*>([\s\S]*?)<\/a>/i) ??
      block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);

    const title = titleMatch ? stripTags(titleMatch[1]) : '';
    if (!title) continue;

    let main: number | null = null;
    let mainExtra: number | null = null;
    let completionist: number | null = null;

    const rowMatches = block.match(/<li[\s\S]*?<\/li>/gi) ?? block.match(/<div[\s\S]*?<\/div>/gi) ?? [];

    for (const row of rowMatches) {
      const label = extractLabel(row);
      const value = extractCellValue(row);
      if (value == null) continue;

      if (label.includes('main story') || label === 'main') {
        if (main == null) main = value;
      } else if (label.includes('main + extras') || label.includes('main extras') || label.includes('main + sides')) {
        if (mainExtra == null) mainExtra = value;
      } else if (label.includes('completionist')) {
        if (completionist == null) completionist = value;
      }
    }

    if (main == null && mainExtra == null && completionist == null) {
      const genericStrongs = block.match(/<strong[^>]*>[\s\S]*?<\/strong>/gi) ?? [];
      const genericValues = genericStrongs
        .map((item) => parseHourText(item))
        .filter((item): item is number => item != null);

      if (genericValues[0] != null) main = genericValues[0];
      if (genericValues[1] != null) mainExtra = genericValues[1];
      if (genericValues[2] != null) completionist = genericValues[2];
    }

    if (main != null || mainExtra != null || completionist != null) {
      candidates.push({
        title,
        main,
        mainExtra,
        completionist,
      });
    }
  }

  return candidates;
}

async function searchLegacy(query: string): Promise<Candidate[]> {
  const form = new URLSearchParams();
  form.set('queryString', query);
  form.set('t', 'games');
  form.set('sorthead', 'popular');
  form.set('sortd', 'Normal Order');
  form.set('plat', '');
  form.set('detail', '0');

  const response = await fetch(
    'https://howlongtobeat.com/search_main.php?page=1',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        accept: 'text/html, */*; q=0.01',
        origin: 'https://howlongtobeat.com',
        referer: 'https://howlongtobeat.com/',
        'user-agent': 'Mozilla/5.0',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: form.toString(),
    },
  );

  if (!response.ok) return [];

  const html = await response.text();
  return parseCandidatesFromHtml(html);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawTitle = Array.isArray(req.query.title) ? req.query.title[0] : req.query.title;

  if (!rawTitle || typeof rawTitle !== 'string' || !rawTitle.trim()) {
    return res.status(200).json({ displayText: '14' });
  }

  const title = rawTitle.trim();

  try {
    const variants = buildSearchVariants(title);
    let candidates: Candidate[] = [];

    for (const variant of variants) {
      const result = await searchLegacy(variant);
      candidates = candidates.concat(result);
      if (result.length > 0) break;
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
      matchedTitle: best.title,
    });
  } catch {
    return res.status(200).json({ displayText: '14' });
  }
}
