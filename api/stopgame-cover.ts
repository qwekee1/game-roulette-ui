import type { VercelRequest, VercelResponse } from '@vercel/node';

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function makeAbsoluteUrl(candidate: string, pageUrl: string): string | null {
  try {
    return new URL(candidate, pageUrl).toString();
  } catch {
    return null;
  }
}

function extractOgImage(html: string, pageUrl: string): string | null {
  const metaPatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
    /<meta[^>]+name=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']og:image["'][^>]*>/i,
  ];

  for (const pattern of metaPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return makeAbsoluteUrl(decodeHtmlEntities(match[1]), pageUrl);
    }
  }

  return null;
}

function extractPosterImage(html: string, pageUrl: string): string | null {
  const blockMatch = html.match(
    /<[^>]+class=["'][^"']*_square-poster_[^"']*["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["'][^>]*>/i,
  );

  if (blockMatch?.[1]) {
    return makeAbsoluteUrl(decodeHtmlEntities(blockMatch[1]), pageUrl);
  }

  const reverseBlockMatch = html.match(
    /<img[^>]+src=["']([^"']+)["'][^>]*>[\s\S]*?<[^>]+class=["'][^"']*_square-poster_[^"']*["'][^>]*>/i,
  );

  if (reverseBlockMatch?.[1]) {
    return makeAbsoluteUrl(decodeHtmlEntities(reverseBlockMatch[1]), pageUrl);
  }

  const genericImgNearClass = html.match(
    /_square-poster_[^"']*[\s\S]{0,1200}?<img[^>]+src=["']([^"']+)["'][^>]*>/i,
  );

  if (genericImgNearClass?.[1]) {
    return makeAbsoluteUrl(decodeHtmlEntities(genericImgNearClass[1]), pageUrl);
  }

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawUrl = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;

  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).json({ imageUrl: null, error: 'Missing url' });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    return res.status(400).json({ imageUrl: null, error: 'Invalid url' });
  }

  if (!/(\.|^)stopgame\.ru$/i.test(targetUrl.hostname)) {
    return res.status(400).json({ imageUrl: null, error: 'Only stopgame.ru is allowed' });
  }

  try {
    const response = await fetch(targetUrl.toString(), {
      headers: {
        'user-agent':
          'Mozilla/5.0 (compatible; GameRouletteBot/1.0; +https://vercel.com/)',
        accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        imageUrl: null,
        error: `Upstream returned ${response.status}`,
      });
    }

    const html = await response.text();

    const imageUrl =
      extractOgImage(html, targetUrl.toString()) ??
      extractPosterImage(html, targetUrl.toString()) ??
      null;

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');

    return res.status(200).json({ imageUrl });
  } catch {
    return res.status(500).json({ imageUrl: null, error: 'Failed to fetch StopGame page' });
  }
}