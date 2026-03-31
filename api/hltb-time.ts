import type { VercelRequest, VercelResponse } from '@vercel/node';

type HltbItem = {
  game_name?: string;
  comp_main?: number;        // main story (seconds)
  comp_plus?: number;        // main + extra
  comp_100?: number;         // completionist
};

function secondsToHoursText(seconds?: number | null): string | null {
  if (!seconds || seconds <= 0) return null;

  const hours = seconds / 3600;
  const rounded = Math.round(hours * 10) / 10;

  if (Number.isInteger(rounded)) return `${rounded} ч`;
  return `${rounded.toFixed(1)} ч`;
}

function normalize(str: string) {
  return str.toLowerCase().replace(/[^\w\s]/g, '').trim();
}

function pickBest(items: HltbItem[], query: string): HltbItem | null {
  const q = normalize(query);

  let best: HltbItem | null = null;
  let bestScore = 0;

  for (const item of items) {
    const name = normalize(item.game_name || '');

    let score = 0;

    if (name === q) score += 3;
    if (name.includes(q)) score += 2;
    if (q.includes(name)) score += 1;

    if (item.comp_main) score += 0.5;

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return best;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawTitle = Array.isArray(req.query.title)
    ? req.query.title[0]
    : req.query.title;

  if (!rawTitle || typeof rawTitle !== 'string') {
    return res.status(200).json({ displayText: '14' });
  }

  try {
    const response = await fetch('https://howlongtobeat.com/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        origin: 'https://howlongtobeat.com',
        referer: 'https://howlongtobeat.com/',
        'user-agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({
        searchType: 'games',
        searchTerms: rawTitle.split(' '),
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
      }),
    });

    if (!response.ok) {
      return res.status(200).json({ displayText: '14' });
    }

    const data = await response.json();
    const items: HltbItem[] = data?.data ?? [];

    if (!items.length) {
      return res.status(200).json({ displayText: '14' });
    }

    const best = pickBest(items, rawTitle);

    if (!best) {
      return res.status(200).json({ displayText: '14' });
    }

    const text =
      secondsToHoursText(best.comp_main) ||
      secondsToHoursText(best.comp_plus) ||
      secondsToHoursText(best.comp_100) ||
      '14';

    return res.status(200).json({
      displayText: text,
    });
  } catch (e) {
    return res.status(200).json({ displayText: '14' });
  }
}