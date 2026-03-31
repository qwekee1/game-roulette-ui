import type { VercelRequest, VercelResponse } from '@vercel/node';

type DebugCandidate = {
  title: string;
  mainRaw: unknown;
  mainExtraRaw: unknown;
  completionistRaw: unknown;
  source: string;
};

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchVariants(title: string): string[] {
  const base = title.trim();
  const normalized = normalizeTitle(base);
  const colonCut = base.split(':')[0]?.trim() ?? '';
  const dashCut = base.split('-')[0]?.trim() ?? '';

  return uniqueStrings([base, normalized, colonCut, dashCut]);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function collectDirectCandidates(payload: unknown, source: string): DebugCandidate[] {
  const out: DebugCandidate[] = [];

  const walk = (value: unknown) => {
    if (!value) return;

    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }

    if (typeof value !== 'object') return;

    const obj = value as Record<string, unknown>;

    const title =
      asString(obj.game_name) ||
      asString(obj.gameName) ||
      asString(obj.title) ||
      asString(obj.name);

    const mainRaw = obj.comp_main ?? obj.gameplayMain ?? obj.main;
    const mainExtraRaw = obj.comp_plus ?? obj.gameplayMainExtra ?? obj.mainExtra;
    const completionistRaw = obj.comp_100 ?? obj.gameplayCompletionist ?? obj.completionist;

    if (title && (mainRaw != null || mainExtraRaw != null || completionistRaw != null)) {
      out.push({
        title,
        mainRaw,
        mainExtraRaw,
        completionistRaw,
        source,
      });
    }

    for (const child of Object.values(obj)) {
      if (child && typeof child === 'object') walk(child);
    }
  };

  walk(payload);
  return out;
}

function collectPublicCandidates(payload: unknown, source: string): DebugCandidate[] {
  const out: DebugCandidate[] = [];

  if (!payload || typeof payload !== 'object') return out;

  const root = payload as Record<string, unknown>;
  const results = Array.isArray(root.results) ? root.results : [];

  for (const item of results) {
    if (!item || typeof item !== 'object') continue;

    const obj = item as Record<string, unknown>;
    const title = asString(obj.title);
    const times = (obj.times && typeof obj.times === 'object') ? (obj.times as Record<string, unknown>) : {};

    if (!title) continue;

    out.push({
      title,
      mainRaw: times.main ?? null,
      mainExtraRaw: times.mainExtra ?? null,
      completionistRaw: times.completionist ?? null,
      source,
    });
  }

  return out;
}

async function fetchDirect(query: string) {
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

  const text = await response.text();

  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    rawTextPreview: text.slice(0, 2000),
    candidates: json ? collectDirectCandidates(json, `direct:${query}`) : [],
  };
}

async function fetchPublic(query: string) {
  const response = await fetch(`https://htlb.berkankutuk.dk/api/search?q=${encodeURIComponent(query)}`, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Mozilla/5.0',
    },
  });

  const text = await response.text();

  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    rawTextPreview: text.slice(0, 2000),
    candidates: json ? collectPublicCandidates(json, `public:${query}`) : [],
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawTitle = Array.isArray(req.query.title) ? req.query.title[0] : req.query.title;

  if (!rawTitle || typeof rawTitle !== 'string' || !rawTitle.trim()) {
    return res.status(200).json({
      error: 'Missing title',
    });
  }

  const title = rawTitle.trim();
  const variants = buildSearchVariants(title);

  try {
    const debug = [];

    for (const variant of variants) {
      const [direct, publicApi] = await Promise.allSettled([
        fetchDirect(variant),
        fetchPublic(variant),
      ]);

      debug.push({
        query: variant,
        direct:
          direct.status === 'fulfilled'
            ? direct.value
            : { ok: false, status: 0, rawTextPreview: String(direct.reason), candidates: [] },
        publicApi:
          publicApi.status === 'fulfilled'
            ? publicApi.value
            : { ok: false, status: 0, rawTextPreview: String(publicApi.reason), candidates: [] },
      });
    }

    return res.status(200).json({
      title,
      variants,
      debug,
    });
  } catch (error) {
    return res.status(200).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
