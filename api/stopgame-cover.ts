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

function pickBestFromSrcset(srcset: string): string | null {
  const parts = srcset
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (parts.length === 0) return null;

  const parsed = parts
    .map((item) => {
      const [url, size] = item.split(/\s+/);
      const widthMatch = size?.match(/^(\d+)w$/i);
      return {
        url,
        width: widthMatch ? Number(widthMatch[1]) : 0,
      };
    })
    .filter((item) => item.url);

  if (parsed.length === 0) return null;

  parsed.sort((a, b) => b.width - a.width);
  return parsed[0].url;
}

function extractPosterFromSquarePoster(html: string, pageUrl: string): string | null {
  const blockRegex =
    /<[^>]+class=["'][^"']*_square-poster_[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi;

  const blocks = html.match(blockRegex) ?? [];

  for (const block of blocks) {
    const sourceSrcsetMatch = block.match(/<source[^>]+srcset=["']([^"']+)["'][^>]*>/i);
    if (sourceSrcsetMatch?.[1]) {
      const bestSrc = pickBestFromSrcset(decodeHtmlEntities(sourceSrcsetMatch[1]));
      if (bestSrc) {
        const absolute = makeAbsoluteUrl(bestSrc, pageUrl);
        if (absolute) return absolute;
      }
    }

    const imgSrcsetMatch = block.match(/<img[^>]+srcset=["']([^"']+)["'][^>]*>/i);
    if (imgSrcsetMatch?.[1]) {
      const bestSrc = pickBestFromSrcset(decodeHtmlEntities(imgSrcsetMatch[1]));
      if (bestSrc) {
        const absolute = makeAbsoluteUrl(bestSrc, pageUrl);
        if (absolute) return absolute;
      }
    }

    const imgSrcMatch = block.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
    if (imgSrcMatch?.[1]) {
      const absolute = makeAbsoluteUrl(decodeHtmlEntities(imgSrcMatch[1]), pageUrl);
      if (absolute) return absolute;
    }
  }

  return null;
}

function extractPosterNearSquarePoster(html: string, pageUrl: string): string | null {
  const nearbyRegex =
    /_square-poster_[^"']*[\s\S]{0,2500}?(?:<source[^>]+srcset=["']([^"']+)["'][^>]*>|<img[^>]+srcset=["']([^"']+)["'][^>]*>|<img[^>]+src=["']([^"']+)["'][^>]*>)/i;

  const match = html.match(nearbyRegex);
  const sourceSrcset = match?.[1];
  const imgSrcset = match?.[2];
  const imgSrc = match?.[3];

  if (sourceSrcset) {
    const bestSrc = pickBestFromSrcset(decodeHtmlEntities(sourceSrcset));
    if (bestSrc) {
      const absolute = makeAbsoluteUrl(bestSrc, pageUrl);
      if (absolute) return absolute;
    }
  }

  if (imgSrcset) {
    const bestSrc = pickBestFromSrcset(decodeHtmlEntities(imgSrcset));
    if (bestSrc) {
      const absolute = makeAbsoluteUrl(bestSrc, pageUrl);
      if (absolute) return absolute;
    }
  }

  if (imgSrc) {
    const absolute = makeAbsoluteUrl(decodeHtmlEntities(imgSrc), pageUrl);
    if (absolute) return absolute;
  }

  return null;
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
      const absolute = makeAbsoluteUrl(decodeHtmlEntities(match[1]), pageUrl);
      if (absolute) return absolute;
    }
  }

  return null;
}

function extractAnyLargeImage(html: string, pageUrl: string): string | null {
  const sourceMatch = html.match(/<source[^>]+srcset=["']([^"']+)["'][^>]*>/i);
  if (sourceMatch?.[1]) {
    const bestSrc = pickBestFromSrcset(decodeHtmlEntities(sourceMatch[1]));
    if (bestSrc) {
      const absolute = makeAbsoluteUrl(bestSrc, pageUrl);
      if (absolute) return absolute;
    }
  }

  const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
  if (imgMatch?.[1]) {
    const absolute = makeAbsoluteUrl(decodeHtmlEntities(imgMatch[1]), pageUrl);
    if (absolute) return absolute;
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
      extractPosterFromSquarePoster(html, targetUrl.toString()) ??
      extractPosterNearSquarePoster(html, targetUrl.toString()) ??
      extractOgImage(html, targetUrl.toString()) ??
      extractAnyLargeImage(html, targetUrl.toString()) ??
      null;

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');

    return res.status(200).json({ imageUrl });
  } catch {
    return res.status(500).json({ imageUrl: null, error: 'Failed to fetch StopGame page' });
  }
}
