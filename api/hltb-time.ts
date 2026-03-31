import type { VercelRequest, VercelResponse } from '@vercel/node';

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, ' ')
    .replace(/&nbsp;/g, ' ');
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildAbsoluteUrl(pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl, 'https://howlongtobeat.com').toString();
  } catch {
    return '';
  }
}

function toDisplayTextFromHours(hours: number | null | undefined): string | null {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return null;

  const rounded = Math.round(hours * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded} ч`;
  return `${rounded.toFixed(1)} ч`;
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreCandidate(url: string, query: string): number {
  const normalizedQuery = normalizeTitle(query);
  const decodedUrl = decodeURIComponent(url);
  const normalizedUrl = normalizeTitle(decodedUrl);

  let score = 0;

  if (normalizedUrl.includes(normalizedQuery)) score += 100;

  const queryWords = normalizedQuery.split(' ').filter(Boolean);
  for (const word of queryWords) {
    if (normalizedUrl.includes(word)) score += 5;
  }

  return score;
}

function extractGameLinksFromHtml(html: string, query: string): string[] {
  const links = new Set<string>();

  const hrefRegex = /href=["']([^"']*\/game\/[^"']+)["']/gi;
  let match: RegExpExecArray | null = null;

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = buildAbsoluteUrl(match[1]);
    if (href) links.add(href);
  }

  return [...links].sort((a, b) => scoreCandidate(b, query) - scoreCandidate(a, query));
}

function extractHoursByLabels(html: string): number | null {
  const decoded = decodeHtml(html);

  const patterns = [
    /Main\s*Story[\s\S]{0,200}?(\d+(?:\.\d+)?)\s*(?:Hours|Hour|Hrs|Hr)/i,
    /Main\s*\+\s*Sides?[\s\S]{0,200}?(\d+(?:\.\d+)?)\s*(?:Hours|Hour|Hrs|Hr)/i,
    /Completionist[\s\S]{0,200}?(\d+(?:\.\d+)?)\s*(?:Hours|Hour|Hrs|Hr)/i,
  ];

  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match?.[1]) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }

  return null;
}

function stripHtmlToText(html: string): string {
  return normalizeSpaces(
    decodeHtml(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
    ),
  );
}

function extractHoursFromPlainText(text: string): number | null {
  const patterns = [
    /Main\s*Story\s*(\d+(?:\.\d+)?)\s*(?:Hours|Hour|Hrs|Hr)/i,
    /Main\s*\+\s*Sides?\s*(\d+(?:\.\d+)?)\s*(?:Hours|Hour|Hrs|Hr)/i,
    /Completionist\s*(\d+(?:\.\d+)?)\s*(?:Hours|Hour|Hrs|Hr)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }

  return null;
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

async function resolveHltbTime(title: string): Promise<string> {
  const searchUrls = [
    `https://howlongtobeat.com/?q=${encodeURIComponent(title)}`,
    `https://howlongtobeat.com/search-results?q=${encodeURIComponent(title)}`,
  ];

  for (const searchUrl of searchUrls) {
    const searchHtml = await fetchHtml(searchUrl);
    if (!searchHtml) continue;

    const directHours = extractHoursByLabels(searchHtml);
    if (directHours) {
      return toDisplayTextFromHours(directHours) ?? '14';
    }

    const gameLinks = extractGameLinksFromHtml(searchHtml, title);

    for (const gameUrl of gameLinks.slice(0, 5)) {
      const gameHtml = await fetchHtml(gameUrl);
      if (!gameHtml) continue;

      const labeledHours = extractHoursByLabels(gameHtml);
      if (labeledHours) {
        return toDisplayTextFromHours(labeledHours) ?? '14';
      }

      const plainText = stripHtmlToText(gameHtml);
      const textHours = extractHoursFromPlainText(plainText);
      if (textHours) {
        return toDisplayTextFromHours(textHours) ?? '14';
      }
    }
  }

  return '14';
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
    const displayText = await resolveHltbTime(title);

    return res.status(200).json({
      displayText: displayText || '14',
    });
  } catch {
    return res.status(200).json({
      displayText: '14',
    });
  }
}
