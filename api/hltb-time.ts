import type { VercelRequest, VercelResponse } from '@vercel/node';

type Candidate = {
  title: string;
  main: number | null;
  mainExtra: number | null;
  completionist: number | null;
  source: string;
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
  return [...new Set(items.filter(Boolean))];
}

function buildSearchVariants(title: string): string[] {
  const cleaned = normalizeTitle(title);
  const compact = cleaned
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return uniqueStrings([title.trim(), cleaned, compact]);
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

function normalizeHours(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;

  // HLTB values often come either in hours or in seconds depending on source.
  if (value > 300) {
    const hours = value / 3600;
    return Number.isFinite(hours) && hours > 0 ? hours : null;
  }

  return value;
}

function toDisplayText(hours: number | null | undefined): string | null {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return null;

  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} ч` : `${rounded.toFixed(1)} ч`;
}

function fetchNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = normalizeHours(obj[key]);
    if (value != null) return value;
  }
  return null;
}

function fetchString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function candidateFromObject(obj: Record<string, unknown>, source: string): Candidate | null {
  const title = fetchString(obj, [
    'game_name',
    'gameName',
    'title',
    'name',
    'game_title',
    'gameTitle',
  ]);

  const main = fetchNumber(obj, [
    'comp_main',
    'compMain',
    'main',
    'mainStory',
    'gameplayMain',
  ]);

  const mainExtra = fetchNumber(obj, [
    'comp_plus',
    'compPlus',
    'mainExtra',
    'main_plus',
    'mainSides',
  ]);

  const completionist = fetchNumber(obj, [
    'comp_100',
    'comp100',
    'completionist',
    'fullComplete',
  ]);

  if (!title) return null;
  if (main == null && mainExtra == null && completionist == null) return null;

  return {
    title,
    main,
    mainExtra,
    completionist,
    source,
  };
}

function collectCandidatesFromValue(
  value: unknown,
  source: string,
  out: Candidate[],
  visited = new WeakSet<object>(),
): void {
  if (!value || typeof value !== 'object') return;
  if (visited.has(value as object)) return;
  visited.add(value as object);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectCandidatesFromValue(item, source, out, visited);
    }
    return;
  }

  const obj = value as Record<string, unknown>;
  const candidate = candidateFromObject(obj, source);
  if (candidate) out.push(candidate);

  for (const child of Object.values(obj)) {
    collectCandidatesFromValue(child, source, out, visited);
  }
}

function extractJsonScriptContents(html: string): string[] {
  const results: string[] = [];
  const regex = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(html)) !== null) {
    const content = match[1]?.trim();
    if (content) results.push(content);
  }

  const nextRegex = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((match = nextRegex.exec(html)) !== null) {
    const content = match[1]?.trim();
    if (content) results.push(content);
  }

  return uniqueStrings(results);
}

function extractCandidatesFromJsonScripts(html: string, source: string): Candidate[] {
  const candidates: Candidate[] = [];
  const scripts = extractJsonScriptContents(html);

  for (const content of scripts) {
    try {
      const parsed = JSON.parse(content);
      collectCandidatesFromValue(parsed, source, candidates);
    } catch {
      // ignore broken json blocks
    }
  }

  return candidates;
}

function extractGameLinksFromHtml(html: string): string[] {
  const links = new Set<string>();
  const regex = /href=["']([^"']*\/game\/[^"']+)["']/gi;

  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(html)) !== null) {
    try {
      links.add(new URL(match[1], 'https://howlongtobeat.com').toString());
    } catch {
      // ignore invalid urls
    }
  }

  return [...links];
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Mozilla/5.0',
      },
    });

    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function resolveCandidatesByHtml(title: string): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const variants = buildSearchVariants(title);

  for (const variant of variants) {
    const searchUrls = [
      `https://howlongtobeat.com/?q=${encodeURIComponent(variant)}`,
      `https://howlongtobeat.com/search-results?q=${encodeURIComponent(variant)}`,
    ];

    for (const searchUrl of searchUrls) {
      const searchHtml = await fetchHtml(searchUrl);
      if (!searchHtml) continue;

      candidates.push(...extractCandidatesFromJsonScripts(searchHtml, `search:${variant}`));

      const gameLinks = extractGameLinksFromHtml(searchHtml)
        .sort((a, b) => {
          const aScore = normalizeTitle(decodeURIComponent(a)).includes(normalizeTitle(variant)) ? 1 : 0;
          const bScore = normalizeTitle(decodeURIComponent(b)).includes(normalizeTitle(variant)) ? 1 : 0;
          return bScore - aScore;
        })
        .slice(0, 5);

      for (const gameUrl of gameLinks) {
        const gameHtml = await fetchHtml(gameUrl);
        if (!gameHtml) continue;
        candidates.push(...extractCandidatesFromJsonScripts(gameHtml, `game:${gameUrl}`));
      }
    }
  }

  return candidates;
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const map = new Map<string, Candidate>();

  for (const candidate of candidates) {
    const key = `${normalizeTitle(candidate.title)}|${candidate.main ?? ''}|${candidate.mainExtra ?? ''}|${candidate.completionist ?? ''}`;
    if (!map.has(key)) map.set(key, candidate);
  }

  return [...map.values()];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawTitle = Array.isArray(req.query.title) ? req.query.title[0] : req.query.title;

  if (!rawTitle || typeof rawTitle !== 'string' || !rawTitle.trim()) {
    return res.status(200).json({ displayText: '14' });
  }

  const title = rawTitle.trim();

  try {
    const rawCandidates = await resolveCandidatesByHtml(title);
    const candidates = dedupeCandidates(rawCandidates);

    if (candidates.length === 0) {
      return res.status(200).json({ displayText: '14' });
    }

    const best = [...candidates].sort((a, b) => scoreCandidate(b, title) - scoreCandidate(a, title))[0];

    const displayText =
      toDisplayText(best.main) ??
      toDisplayText(best.mainExtra) ??
      toDisplayText(best.completionist) ??
      '14';

    return res.status(200).json({
      displayText,
      matchedTitle: best.title,
      debugSource: best.source,
    });
  } catch {
    return res.status(200).json({ displayText: '14' });
  }
}
