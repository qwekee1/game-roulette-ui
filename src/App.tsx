import React, { useEffect, useMemo, useRef, useState } from 'react';
import rawDatabase from './data/games_roulette_database_hltb_final.json';

type Difficulty = 'Очень легко' | 'Легко' | 'Нормально' | 'Сложно' | 'Хардкор';
type ActiveThumb = 'min' | 'max';

type AudioContextCtor = {
  new (): AudioContext;
};

type RawGameEntry = {
  id: number | string;
  name: string;
  url_stopgame: string;
  rating?: number | string | null;
  rating_hltb?: number | string | null;
  hours?: number | string | null;
  weight?: number | null;
  year_range?: string | null;
};

type RawDatabase = {
  total_games?: number;
  games?: RawGameEntry[];
};

type GameEntry = {
  id: string;
  title: string;
  stopgameUrl: string;
  stopgameSlug?: string;
  ratingValue: number | null;
  ratingHltbValue: number | null;
  hoursValue: number | null;
  yearRangeRaw: string | null;
  yearStart: number | null;
  yearEnd: number | null;
  rating?: {
    value?: number | null;
    text?: string | null;
    allObservedValues?: string[];
  };
  period?: {
    label?: string;
    startYear?: number;
    endYear?: number;
  };
  assets?: {
    stopgameCoverUrl?: string | null;
    stopgameCoverFetched?: boolean;
    notes?: string;
  };
};

const database = rawDatabase as RawDatabase;
const DIFFICULTIES: Difficulty[] = ['Очень легко', 'Легко', 'Нормально', 'Сложно', 'Хардкор'];

const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = {
  'Очень легко': 0.5,
  Легко: 0.75,
  Нормально: 1,
  Сложно: 1.25,
  Хардкор: 1.5,
};

const DESIGN_WIDTH = 1728;
const DESIGN_HEIGHT = 972;

const LANE_ITEM_HEIGHT = 92;
const STEP_GAP = 10;
const STEP_DISTANCE = LANE_ITEM_HEIGHT + STEP_GAP;
const VISIBLE_ROWS = 9;
const WINNER_ROW_INDEX = 4;
const SPIN_OVERSHOOT = 22;
const VISIBLE_TRACK_HEIGHT =
  VISIBLE_ROWS * LANE_ITEM_HEIGHT + (VISIBLE_ROWS - 1) * STEP_GAP;

const MIN_RATING = 0;
const MAX_RATING = 5;
const DEFAULT_ROUND_SIZE = 14;
const MIN_ROUND_SIZE = 3;
const MAX_ROUND_SIZE = 14;

const PERIOD_BUCKETS = [
  { label: '1980–1989', start: 1980, end: 1989 },
  { label: '1990–1994', start: 1990, end: 1994 },
  { label: '1995–1999', start: 1995, end: 1999 },
  { label: '2000–2004', start: 2000, end: 2004 },
  { label: '2005–2009', start: 2005, end: 2009 },
  { label: '2010–2014', start: 2010, end: 2014 },
  { label: '2015–2019', start: 2015, end: 2019 },
  { label: '2020–2025', start: 2020, end: 2025 },
] as const;

const LS_SOUND_VOLUME = 'soundVolume';
const LS_RATING_MIN = 'rouletteRatingMin';
const LS_RATING_MAX = 'rouletteRatingMax';
const LS_PERIOD_MIN_INDEX = 'roulettePeriodMinIndex';
const LS_PERIOD_MAX_INDEX = 'roulettePeriodMaxIndex';
const LS_ROUND_SIZE = 'rouletteRoundSize';
const LS_HISTORY = 'rouletteHistory';

const THUMB_SIZE_PX = 20;

const coverUrlCache = new Map<string, string | null>();

function loadHistory(): GameEntry[] {
  try {
    const raw = window.localStorage.getItem(LS_HISTORY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveHistory(history: GameEntry[]) {
  window.localStorage.setItem(LS_HISTORY, JSON.stringify(history.slice(0, 50)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const normalized = value
      .trim()
      .replace(',', '.')
      .replace(/[^\d.-]/g, '');

    if (!normalized) return null;

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseYearRange(yearRange?: string | null): { start: number | null; end: number | null } {
  if (!yearRange) return { start: null, end: null };

  const match = yearRange.match(/(\d{4})\D+(\d{4})/);
  if (match) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      return {
        start: Math.min(start, end),
        end: Math.max(start, end),
      };
    }
  }

  const single = yearRange.match(/(\d{4})/);
  if (single) {
    const year = Number(single[1]);
    if (Number.isFinite(year)) {
      return { start: year, end: year };
    }
  }

  return { start: null, end: null };
}

function toGameEntry(raw: RawGameEntry): GameEntry {
  const parsedYears = parseYearRange(raw.year_range);
  const ratingValue = parseNumericValue(raw.rating) ?? 0;
  const ratingHltbValue = parseNumericValue(raw.rating_hltb) ?? 0;
  const hoursValue = parseNumericValue(raw.hours) ?? 0;

  return {
    id: String(raw.id),
    title: raw.name,
    stopgameUrl: raw.url_stopgame,
    stopgameSlug: raw.url_stopgame.split('/').filter(Boolean).pop(),
    ratingValue,
    ratingHltbValue,
    hoursValue,
    yearRangeRaw: raw.year_range ?? null,
    yearStart: parsedYears.start,
    yearEnd: parsedYears.end,
    rating: {
      value: ratingValue,
      text: Number.isFinite(ratingValue) ? ratingValue.toFixed(1) : null,
      allObservedValues: Number.isFinite(ratingValue) ? [ratingValue.toFixed(1)] : [],
    },
    period: {
      label: raw.year_range ?? '—',
      startYear: parsedYears.start ?? undefined,
      endYear: parsedYears.end ?? undefined,
    },
    assets: {
      stopgameCoverUrl: null,
      stopgameCoverFetched: false,
    },
  };
}

function dedupeGames(items: GameEntry[]): GameEntry[] {
  const seen = new Map<string, GameEntry>();
  for (const game of items) {
    const key = (game.stopgameUrl || game.id || game.title).trim().toLowerCase();
    if (!seen.has(key)) seen.set(key, game);
  }
  return Array.from(seen.values());
}

function getGamesDb(): GameEntry[] {
  return dedupeGames((database.games ?? []).map(toGameEntry));
}

function getRandomGames(items: GameEntry[], count: number): GameEntry[] {
  if (items.length === 0 || count <= 0) return [];
  const uniqueItems = dedupeGames(items);
  if (uniqueItems.length <= count) return [...uniqueItems];

  const copy = [...uniqueItems];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

function buildVisibleGames(source: GameEntry[], centerIndex: number): GameEntry[] {
  const items: GameEntry[] = [];
  const total = source.length;
  if (total === 0) return items;

  for (let offset = -WINNER_ROW_INDEX; offset < VISIBLE_ROWS - WINNER_ROW_INDEX; offset += 1) {
    const index = (centerIndex + offset + total) % total;
    items.push(source[index]);
  }
  return items;
}

function buildSpinSequence(source: GameEntry[], centerIndex: number, totalSteps: number): GameEntry[] {
  const sequence: GameEntry[] = [];
  if (source.length === 0) return sequence;

  for (
    let offset = -WINNER_ROW_INDEX;
    offset <= totalSteps + (VISIBLE_ROWS - WINNER_ROW_INDEX - 1);
    offset += 1
  ) {
    const index = (centerIndex + offset + source.length) % source.length;
    sequence.push(source[index]);
  }
  return sequence;
}

function getRatingText(game: GameEntry | null): string {
  if (!game) return '—';
  return game.rating?.text ?? game.rating?.value?.toFixed(1) ?? '—';
}

function getHoursText(game: GameEntry | null): string {
  if (!game) return '—';

  const hours = game.hoursValue ?? 0;
  if (!Number.isFinite(hours) || hours <= 0) return '—';

  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} ч` : `${rounded.toFixed(1)} ч`;
}

function getPointsText(game: GameEntry | null, difficulty: Difficulty): string {
  if (!game) return '—';

  const baseScore =
    (game.ratingValue ?? 0) +
    (game.ratingHltbValue ?? 0) +
    (game.hoursValue ?? 0);

  const total = baseScore * DIFFICULTY_MULTIPLIER[difficulty];
  const rounded = Math.round(total * 100) / 100;

  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');
}

function getStopgameButtonHref(game: GameEntry | null): string {
  return game?.stopgameUrl ?? 'https://stopgame.ru/';
}

function buildSearchUrl(baseUrl: string, query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return baseUrl;
  return `${baseUrl}${encodeURIComponent(trimmed)}`;
}

function getSteamButtonHref(game: GameEntry | null): string {
  return buildSearchUrl('https://store.steampowered.com/search/?term=', game?.title ?? '');
}

function getHltbButtonHref(game: GameEntry | null): string {
  return buildSearchUrl('https://howlongtobeat.com/?q=', game?.title ?? '');
}

function getPlaceholderRows(count: number): Array<{ id: string; title: string }> {
  return Array.from({ length: count }, (_, index) => ({
    id: `placeholder-${index}`,
    title: '',
  }));
}

function matchesFilters(
  game: GameEntry,
  ratingMin: number,
  ratingMax: number,
  periodMinIndex: number,
  periodMaxIndex: number,
): boolean {
  const rating = game.ratingValue ?? 0;
  if (rating < ratingMin || rating > ratingMax) return false;

  const selectedStart = PERIOD_BUCKETS[periodMinIndex].start;
  const selectedEnd = PERIOD_BUCKETS[periodMaxIndex].end;

  const start = game.yearStart ?? PERIOD_BUCKETS[0].start;
  const end = game.yearEnd ?? PERIOD_BUCKETS[PERIOD_BUCKETS.length - 1].end;

  return end >= selectedStart && start <= selectedEnd;
}

function readNumberFromStorage(key: string, fallback: number): number {
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getPeriodDisplay(periodMinIndex: number, periodMaxIndex: number): string {
  return `${PERIOD_BUCKETS[periodMinIndex].start}–${PERIOD_BUCKETS[periodMaxIndex].end}`;
}

function normalizeCoverUrl(candidate: unknown, stopgameUrl: string): string | null {
  if (typeof candidate !== 'string') return null;

  const trimmed = candidate.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('data:image/')) return trimmed;

  try {
    if (trimmed.startsWith('//')) {
      return `https:${trimmed}`;
    }

    if (trimmed.startsWith('/')) {
      const stopgameOrigin = new URL(stopgameUrl).origin;
      return new URL(trimmed, stopgameOrigin).toString();
    }

    return new URL(trimmed).toString();
  } catch {
    try {
      return new URL(trimmed, stopgameUrl).toString();
    } catch {
      return null;
    }
  }
}

function extractCoverUrlFromPayload(payload: unknown, stopgameUrl: string): string | null {
  if (!payload || typeof payload !== 'object') return null;

  const record = payload as Record<string, unknown>;

  const directCandidates = [
    record.imageUrl,
    record.image_url,
    record.coverUrl,
    record.cover_url,
    record.posterUrl,
    record.poster_url,
    record.url,
    record.src,
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizeCoverUrl(candidate, stopgameUrl);
    if (normalized) return normalized;
  }

  const nestedCandidates = [
    record.data,
    record.result,
    record.payload,
    record.cover,
    record.poster,
    record.image,
  ];

  for (const nested of nestedCandidates) {
    const nestedResult = extractCoverUrlFromPayload(nested, stopgameUrl);
    if (nestedResult) return nestedResult;
  }

  return null;
}

async function fetchStopgameCover(stopgameUrl: string): Promise<string | null> {
  const normalizedStopgameUrl = stopgameUrl.trim();
  if (!normalizedStopgameUrl) return null;

  if (coverUrlCache.has(normalizedStopgameUrl)) {
    return coverUrlCache.get(normalizedStopgameUrl) ?? null;
  }

  try {
    const response = await fetch(`/api/stopgame-cover?url=${encodeURIComponent(normalizedStopgameUrl)}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
    });

    if (!response.ok) {
      coverUrlCache.set(normalizedStopgameUrl, null);
      return null;
    }

    const contentType = response.headers.get('content-type') ?? '';

    let finalUrl: string | null = null;

    if (contentType.includes('application/json')) {
      const data = (await response.json()) as unknown;
      finalUrl = extractCoverUrlFromPayload(data, normalizedStopgameUrl);
    } else {
      const text = await response.text();
      try {
        const parsed = JSON.parse(text) as unknown;
        finalUrl = extractCoverUrlFromPayload(parsed, normalizedStopgameUrl);
      } catch {
        finalUrl = normalizeCoverUrl(text, normalizedStopgameUrl);
      }
    }

    coverUrlCache.set(normalizedStopgameUrl, finalUrl);
    return finalUrl;
  } catch {
    coverUrlCache.set(normalizedStopgameUrl, null);
    return null;
  }
}

type RangeSliderProps = {
  min: number;
  max: number;
  step: number;
  minValue: number;
  maxValue: number;
  onMinChange: (value: number) => void;
  onMaxChange: (value: number) => void;
};

function DualRangeSlider({
  min,
  max,
  step,
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
}: RangeSliderProps) {
  const [activeThumb, setActiveThumb] = useState<ActiveThumb>('max');

  const range = max - min;
  const safeRange = range === 0 ? 1 : range;
  const leftPercent = ((minValue - min) / safeRange) * 100;
  const rightPercent = ((maxValue - min) / safeRange) * 100;

  const leftOffsetPx = minValue === min ? 0 : THUMB_SIZE_PX / 2;
  const rightOffsetPx = maxValue === max ? 0 : THUMB_SIZE_PX / 2;
  const isMerged = minValue === maxValue;

  const minInputZIndex = isMerged ? (activeThumb === 'min' ? 40 : 30) : activeThumb === 'min' ? 40 : 20;
  const maxInputZIndex = isMerged ? (activeThumb === 'max' ? 40 : 30) : activeThumb === 'max' ? 40 : 30;

  const minVisualZIndex = isMerged ? (activeThumb === 'min' ? 41 : 40) : 40;
  const maxVisualZIndex = isMerged ? (activeThumb === 'max' ? 41 : 40) : 40;

  return (
    <div className="relative h-8">
      <div className="absolute top-1/2 h-3 w-full -translate-y-1/2 rounded-full bg-zinc-600" />

      <div
        className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full bg-emerald-500"
        style={{
          left: `calc(${leftPercent}% - ${leftOffsetPx}px)`,
          width: `calc(${Math.max(0, rightPercent - leftPercent)}% + ${leftOffsetPx + rightOffsetPx}px)`,
        }}
      />

      <div
        className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.3)]"
        style={{
          left: `calc(${leftPercent}% - ${THUMB_SIZE_PX / 2}px)`,
          zIndex: minVisualZIndex,
        }}
      />

      <div
        className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.3)]"
        style={{
          left: `calc(${rightPercent}% - ${THUMB_SIZE_PX / 2}px)`,
          zIndex: maxVisualZIndex,
        }}
      />

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={minValue}
        onPointerDown={() => setActiveThumb('min')}
        onMouseDown={() => setActiveThumb('min')}
        onTouchStart={() => setActiveThumb('min')}
        onChange={(event) => {
          setActiveThumb('min');
          onMinChange(Number(event.target.value));
        }}
        className="range-thumb pointer-events-none absolute left-0 top-1/2 h-8 w-full -translate-y-1/2 appearance-none bg-transparent"
        style={{ zIndex: minInputZIndex }}
      />

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={maxValue}
        onPointerDown={() => setActiveThumb('max')}
        onMouseDown={() => setActiveThumb('max')}
        onTouchStart={() => setActiveThumb('max')}
        onChange={(event) => {
          setActiveThumb('max');
          onMaxChange(Number(event.target.value));
        }}
        className="range-thumb pointer-events-none absolute left-0 top-1/2 h-8 w-full -translate-y-1/2 appearance-none bg-transparent"
        style={{ zIndex: maxInputZIndex }}
      />
    </div>
  );
}

export default function GameRouletteUI() {
  const [viewportScale, setViewportScale] = useState(1);
  const [gamesDb] = useState<GameEntry[]>(() => getGamesDb());
  const [spinPool, setSpinPool] = useState<GameEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<GameEntry | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('Нормально');
  const [isDifficultyOpen, setIsDifficultyOpen] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [hasSpun, setHasSpun] = useState(false);
  const [centerIndex, setCenterIndex] = useState(0);
  const [spinTranslate, setSpinTranslate] = useState(0);
  const [spinTransition, setSpinTransition] = useState('none');
  const [spinSequence, setSpinSequence] = useState<GameEntry[] | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [soundVolume, setSoundVolume] = useState<number>(() => {
    const saved = window.localStorage.getItem(LS_SOUND_VOLUME);
    return saved !== null ? Number(saved) : 70;
  });

  const [ratingMin, setRatingMin] = useState<number>(() =>
    clamp(readNumberFromStorage(LS_RATING_MIN, MIN_RATING), MIN_RATING, MAX_RATING),
  );
  const [ratingMax, setRatingMax] = useState<number>(() =>
    clamp(readNumberFromStorage(LS_RATING_MAX, MAX_RATING), MIN_RATING, MAX_RATING),
  );
  const [periodMinIndex, setPeriodMinIndex] = useState<number>(() =>
    clamp(readNumberFromStorage(LS_PERIOD_MIN_INDEX, 0), 0, PERIOD_BUCKETS.length - 1),
  );
  const [periodMaxIndex, setPeriodMaxIndex] = useState<number>(() =>
    clamp(readNumberFromStorage(LS_PERIOD_MAX_INDEX, PERIOD_BUCKETS.length - 1), 0, PERIOD_BUCKETS.length - 1),
  );
  const [historyGames, setHistoryGames] = useState<GameEntry[]>(() => loadHistory());
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const addToHistory = (game: GameEntry) => {
    setHistoryGames((prev) => {
      const updated = [game, ...prev.filter((g) => g.id !== game.id)];
      saveHistory(updated);
      return updated.slice(0, 50);
    });
  };

  const [roundSize, setRoundSize] = useState<number>(() =>
    clamp(readNumberFromStorage(LS_ROUND_SIZE, DEFAULT_ROUND_SIZE), MIN_ROUND_SIZE, MAX_ROUND_SIZE),
  );

  const spinTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const settleTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const finalizeTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const tickTimeoutsRef = useRef<Array<ReturnType<typeof window.setTimeout>>>([]);
  const coverRequestIdRef = useRef(0);

  const filteredGamesDb = useMemo(() => {
    return gamesDb.filter((game) =>
      matchesFilters(game, ratingMin, ratingMax, periodMinIndex, periodMaxIndex),
    );
  }, [gamesDb, ratingMin, ratingMax, periodMinIndex, periodMaxIndex]);

  const repeatedSpinPool = useMemo(() => {
    if (spinPool.length === 0) return [];
    return Array.from({ length: 120 }, (_, index) => spinPool[index % spinPool.length]);
  }, [spinPool]);

  useEffect(() => {
    const updateScale = () => {
      const widthScale = window.innerWidth / DESIGN_WIDTH;
      const heightScale = window.innerHeight / DESIGN_HEIGHT;
      setViewportScale(Math.min(widthScale, heightScale));
    };

    updateScale();
    window.addEventListener('resize', updateScale);

    return () => window.removeEventListener('resize', updateScale);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LS_SOUND_VOLUME, String(soundVolume));
  }, [soundVolume]);

  useEffect(() => {
    window.localStorage.setItem(LS_RATING_MIN, String(ratingMin));
    window.localStorage.setItem(LS_RATING_MAX, String(ratingMax));
    window.localStorage.setItem(LS_PERIOD_MIN_INDEX, String(periodMinIndex));
    window.localStorage.setItem(LS_PERIOD_MAX_INDEX, String(periodMaxIndex));
    window.localStorage.setItem(LS_ROUND_SIZE, String(roundSize));
  }, [ratingMin, ratingMax, periodMinIndex, periodMaxIndex, roundSize]);

  useEffect(() => {
    if (selectedGame && !filteredGamesDb.some((game) => game.id === selectedGame.id)) {
      setSelectedGame(null);
    }

    if (spinPool.length > 0) {
      const filteredPool = spinPool.filter((game) =>
        filteredGamesDb.some((allowedGame) => allowedGame.id === game.id),
      );
      if (filteredPool.length !== spinPool.length) {
        setSpinPool(filteredPool);
      }
    }

    if (filteredGamesDb.length === 0) {
      setSpinPool([]);
      setSelectedGame(null);
      setHasSpun(false);
      setSpinSequence(null);
      setSpinTransition('none');
      setSpinTranslate(0);
      setCenterIndex(0);
    }
  }, [filteredGamesDb, selectedGame, spinPool]);

  useEffect(() => {
    return () => {
      if (spinTimeoutRef.current !== null) window.clearTimeout(spinTimeoutRef.current);
      if (settleTimeoutRef.current !== null) window.clearTimeout(settleTimeoutRef.current);
      if (finalizeTimeoutRef.current !== null) window.clearTimeout(finalizeTimeoutRef.current);
      tickTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      tickTimeoutsRef.current = [];
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        void audioContextRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedGame?.stopgameUrl) return;
    if (selectedGame.assets?.stopgameCoverFetched) return;

    const requestId = ++coverRequestIdRef.current;

    void (async () => {
      const coverUrl = await fetchStopgameCover(selectedGame.stopgameUrl);
      if (requestId !== coverRequestIdRef.current) return;

      setSelectedGame((prev) => {
        if (!prev || prev.id !== selectedGame.id) return prev;

        return {
          ...prev,
          assets: {
            ...prev.assets,
            stopgameCoverUrl: coverUrl,
            stopgameCoverFetched: true,
          },
        };
      });

      setSpinPool((prev) =>
        prev.map((game) =>
          game.id === selectedGame.id
            ? {
                ...game,
                assets: {
                  ...game.assets,
                  stopgameCoverUrl: coverUrl,
                  stopgameCoverFetched: true,
                },
              }
            : game,
        ),
      );
    })();
  }, [selectedGame]);

  const visibleGames = useMemo(() => {
    if (repeatedSpinPool.length === 0) return [];
    return buildVisibleGames(repeatedSpinPool, centerIndex);
  }, [centerIndex, repeatedSpinPool]);

  const placeholderCenterRows = useMemo(() => getPlaceholderRows(VISIBLE_ROWS), []);
  const laneGames = hasSpun ? spinSequence ?? visibleGames : placeholderCenterRows;

  const getAudioContext = () => {
    const audioWindow = window as Window & { webkitAudioContext?: AudioContextCtor };
    const AudioContextClass: AudioContextCtor | undefined =
      window.AudioContext ?? audioWindow.webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new AudioContextClass();
    }
    if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current.resume();
    }
    return audioContextRef.current;
  };

  const playTone = (frequency: number, durationMs: number, volume: number, type: OscillatorType) => {
    if (soundVolume === 0) return;

    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);

    const finalVolume = volume * (soundVolume / 100);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(finalVolume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + durationMs / 1000 + 0.02);
  };

  const clearTickTimeouts = () => {
    tickTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    tickTimeoutsRef.current = [];
  };

  const startTickSound = (totalSteps: number, duration: number) => {
    clearTickTimeouts();

    const easing = (t: number) => Math.pow(t, 4.2);
    const baseTimes: number[] = [];
    for (let step = 1; step <= totalSteps; step += 1) {
      const progress = step / totalSteps;
      baseTimes.push(duration * easing(progress));
    }

    const adjustedTimes = baseTimes.map((time, index) => {
      if (index === 0) return Math.max(12, time * 0.25);

      const prev = baseTimes[index - 1];
      const gap = time - prev;
      const slowFactor = index / totalSteps;

      let multiplier = 1.05;
      if (slowFactor > 0.85) multiplier = 2.2;
      else if (slowFactor > 0.7) multiplier = 1.8;
      else if (slowFactor > 0.5) multiplier = 1.4;

      return prev + Math.max(14, gap * multiplier);
    });

    adjustedTimes.forEach((time, index) => {
      if (time > duration - 2000) return;
      const timeoutId = window.setTimeout(() => {
        const progress = (index + 1) / totalSteps;
        const pitch = 1200 - progress * 500;
        const volume = progress < 0.4 ? 0.028 : progress < 0.75 ? 0.022 : 0.018;
        const noteDuration = progress < 0.6 ? 22 : progress < 0.8 ? 40 : progress < 0.9 ? 70 : 120;
        playTone(pitch, noteDuration, volume, 'square');
      }, Math.max(0, Math.round(time)));
      tickTimeoutsRef.current.push(timeoutId);
    });
  };

  const playWinSound = () => {
    playTone(523.25, 160, 0.05, 'triangle');
    window.setTimeout(() => playTone(659.25, 180, 0.05, 'triangle'), 120);
    window.setTimeout(() => playTone(783.99, 260, 0.06, 'triangle'), 250);
  };

  const resetRouletteSettings = () => {
    setRatingMin(MIN_RATING);
    setRatingMax(MAX_RATING);
    setPeriodMinIndex(0);
    setPeriodMaxIndex(PERIOD_BUCKETS.length - 1);
    setRoundSize(DEFAULT_ROUND_SIZE);

    window.localStorage.removeItem(LS_RATING_MIN);
    window.localStorage.removeItem(LS_RATING_MAX);
    window.localStorage.removeItem(LS_PERIOD_MIN_INDEX);
    window.localStorage.removeItem(LS_PERIOD_MAX_INDEX);
    window.localStorage.removeItem(LS_ROUND_SIZE);
  };

  const handleSpin = () => {
    if (isSpinning || filteredGamesDb.length === 0) return;

    if (spinTimeoutRef.current !== null) window.clearTimeout(spinTimeoutRef.current);
    if (settleTimeoutRef.current !== null) window.clearTimeout(settleTimeoutRef.current);
    if (finalizeTimeoutRef.current !== null) window.clearTimeout(finalizeTimeoutRef.current);
    clearTickTimeouts();

    const newRoundGames = getRandomGames(filteredGamesDb, roundSize).map((game) => {
      const cachedCover = coverUrlCache.get(game.stopgameUrl.trim());

      return {
        ...game,
        assets: {
          ...game.assets,
          stopgameCoverUrl: cachedCover ?? game.assets?.stopgameCoverUrl ?? null,
          stopgameCoverFetched: typeof cachedCover !== 'undefined',
        },
      };
    });

    if (newRoundGames.length === 0) return;

    const repeatedPool = Array.from(
      { length: Math.max(120, newRoundGames.length * 12) },
      (_, index) => newRoundGames[index % newRoundGames.length],
    );

    const spinStartIndex = 0;
    const extraLoops = 4;
    const randomExtra = Math.floor(Math.random() * newRoundGames.length);
    const totalSteps = newRoundGames.length * extraLoops + randomExtra;
    const winnerIndex = (spinStartIndex + totalSteps) % repeatedPool.length;
    const winner = repeatedPool[winnerIndex];
    const duration = 5600 + totalSteps * 70;
    const sequence = buildSpinSequence(repeatedPool, spinStartIndex, totalSteps);

    setHasSpun(true);
    setSpinPool(newRoundGames);
    setSelectedGame(null);
    setCenterIndex(spinStartIndex);
    setIsSpinning(true);
    setSpinSequence(sequence);
    setSpinTransition('none');
    setSpinTranslate(0);
    startTickSound(totalSteps, duration);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSpinTransition(`transform ${duration}ms cubic-bezier(0.16, 0.84, 0.24, 1)`);
        setSpinTranslate(-(totalSteps * STEP_DISTANCE + SPIN_OVERSHOOT));
      });
    });

    spinTimeoutRef.current = window.setTimeout(() => {
      setSpinTransition('transform 900ms cubic-bezier(0.25, 1, 0.5, 1)');
      setSpinTranslate(-(totalSteps * STEP_DISTANCE));

      settleTimeoutRef.current = window.setTimeout(() => {
        const finalVisibleGames = buildVisibleGames(repeatedPool, winnerIndex);

        setCenterIndex(winnerIndex);
        setSelectedGame(winner);
        addToHistory(winner);
        setSpinTransition('none');
        setSpinTranslate(0);
        setSpinSequence(finalVisibleGames);

        finalizeTimeoutRef.current = window.setTimeout(() => {
          setSpinSequence(null);
          setIsSpinning(false);
        }, 40);

        clearTickTimeouts();
        playWinSound();
      }, 900);
    }, duration);
  };

  const rightColumnItems = hasSpun ? spinPool : [];
  const rightPlaceholders = !hasSpun ? getPlaceholderRows(roundSize) : [];

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-[#090a0d] text-white"
      style={{ fontFamily: 'Gilroy, ui-sans-serif, system-ui, sans-serif' }}
      onClick={() => {
        if (isDifficultyOpen) setIsDifficultyOpen(false);
      }}
    >
      <div className="absolute left-1/2 top-1/2" style={{ transform: `translate(-50%, -50%) scale(${viewportScale})` }}>
        <div
          className="relative overflow-hidden bg-[#090a0d]"
          style={{
            width: `${DESIGN_WIDTH}px`,
            height: `${DESIGN_HEIGHT}px`,
            transformOrigin: 'center center',
          }}
        >
          <div className="mx-auto flex h-full w-full max-w-[1728px] items-stretch gap-4 p-4">
            <aside className="flex w-[320px] shrink-0 flex-col rounded-[34px] bg-[#101115] px-6 py-6 xl:w-[360px]">
              <div className="rounded-[30px] bg-[#17191e] p-4">
                <div className="overflow-hidden rounded-[18px] bg-transparent leading-none">
                  {selectedGame?.assets?.stopgameCoverUrl ? (
                    <img
                      src={selectedGame.assets.stopgameCoverUrl}
                      alt={selectedGame.title}
                      className="block aspect-square w-full object-cover"
                      loading="eager"
                      referrerPolicy="no-referrer"
                      onError={() => {
                        coverUrlCache.set(selectedGame.stopgameUrl.trim(), null);

                        setSelectedGame((prev) => {
                          if (!prev || prev.id !== selectedGame.id) return prev;
                          return {
                            ...prev,
                            assets: {
                              ...prev.assets,
                              stopgameCoverUrl: null,
                              stopgameCoverFetched: true,
                            },
                          };
                        });

                        setSpinPool((prev) =>
                          prev.map((game) =>
                            game.id === selectedGame.id
                              ? {
                                  ...game,
                                  assets: {
                                    ...game.assets,
                                    stopgameCoverUrl: null,
                                    stopgameCoverFetched: true,
                                  },
                                }
                              : game,
                          ),
                        );
                      }}
                    />
                  ) : (
                    <div className="flex aspect-square items-center justify-center bg-[radial-gradient(circle_at_70%_30%,rgba(255,190,92,0.35),transparent_28%),radial-gradient(circle_at_30%_70%,rgba(93,157,255,0.25),transparent_26%),linear-gradient(180deg,#f8f8f8,#dfe6ef)]">
                      <div className="flex h-full w-full items-center justify-center px-6 text-center text-zinc-800">
                        <div className="text-[14px] font-black leading-[1.15] tracking-[0.12em] xl:text-[16px]">
                          {selectedGame?.title?.toUpperCase() ?? ''}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex h-[54px] items-center justify-center pt-4 xl:h-[64px]">
                  <div className="w-full truncate pb-1 text-center text-[30px] font-semibold leading-[1.12] tracking-[-0.03em]">
                    {selectedGame?.title ?? '\u00A0'}
                  </div>
                </div>
              </div>

              <div className="mt-7 space-y-2.5 xl:space-y-3">
                <InfoRow label="Оценка" value={getRatingText(selectedGame)} />
                <InfoRow label="Время прохождения" value={getHoursText(selectedGame)} />

                <div className="relative">
                  <div className="flex items-center gap-2.5 xl:gap-3">
                    <Pill>Сложность</Pill>

                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setIsDifficultyOpen((prev) => !prev);
                      }}
                      className="inline-flex h-[42px] min-w-0 items-center gap-2 rounded-full bg-white px-3 text-[16px] font-medium text-black transition-all duration-200 ease-out hover:bg-zinc-100 active:scale-[0.98] xl:h-[48px] xl:px-4 xl:text-[18px]"
                    >
                      <span className="block truncate leading-[1.15]">{difficulty}</span>
                      <svg
                        className={`h-4 w-4 shrink-0 transition-transform duration-200 ${isDifficultyOpen ? 'rotate-180' : ''}`}
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  </div>

                  {isDifficultyOpen && (
                    <div
                      className="absolute left-[132px] top-[calc(100%+10px)] z-50 w-[220px] rounded-[24px] bg-white p-2 shadow-2xl"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="space-y-1">
                        {DIFFICULTIES.map((item) => (
                          <button
                            key={item}
                            type="button"
                            onClick={() => {
                              setDifficulty(item);
                              setIsDifficultyOpen(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-[18px] px-4 py-3 text-left text-[16px] font-medium transition xl:text-[18px] ${
                              difficulty === item
                                ? 'bg-zinc-100 text-black'
                                : 'bg-white text-black hover:bg-zinc-100'
                            }`}
                          >
                            <span className="truncate">{item}</span>
                            {difficulty === item && (
                              <svg className="ml-2 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                <path
                                  fillRule="evenodd"
                                  d="M16.704 5.29a1 1 0 0 1 .006 1.414l-8 8a1 1 0 0 1-1.42-.008l-4-4a1 1 0 0 1 1.414-1.414l3.292 3.292 7.296-7.29a1 1 0 0 1 1.412.006Z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <InfoRow label="Очки" value={getPointsText(selectedGame, difficulty)} />
              </div>

              <div className="mt-auto pt-5">
                <div className="flex flex-wrap gap-2.5 xl:gap-3">
                  {[
                    { label: 'SG', href: getStopgameButtonHref(selectedGame) },
                    { label: 'Steam', href: getSteamButtonHref(selectedGame) },
                    { label: 'HLTB', href: getHltbButtonHref(selectedGame) },
                  ].map((item) => (
                    <a
                      key={item.label}
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-[42px] items-center justify-center rounded-full bg-white px-3 text-[16px] font-medium text-black transition-all duration-200 ease-out hover:bg-zinc-100 active:scale-[0.98] xl:h-[48px] xl:px-4 xl:text-[18px]"
                    >
                      <span className="block truncate leading-[1.15]">{item.label}</span>
                    </a>
                  ))}
                </div>
              </div>
            </aside>

            <main className="min-w-0 flex-1 rounded-[34px] bg-[#ececec] p-3">
              <div className="relative h-full rounded-[30px] bg-[#ececec] p-1">
                <div className="relative h-full overflow-hidden rounded-[28px]">
                  <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2">
                    <div className="relative h-[92px]">
                      <div className="absolute left-2 top-1/2 -translate-y-1/2">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-[#ff1e68]">
                          <path d="M9 6c0-.6.7-.9 1.2-.5l7 5c.5.3.5 1 0 1.4l-7 5c-.5.4-1.2 0-1.2-.6V6z" />
                        </svg>
                      </div>

                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-[#ff1e68]">
                          <path d="M15 6c0-.6-.7-.9-1.2-.5l-7 5c-.5.3-.5 1 0 1.4l7 5c.5.4 1.2 0 1.2-.6V6z" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  <div
                    className="absolute inset-x-0 top-1/2 overflow-hidden -translate-y-1/2"
                    style={{ height: `${VISIBLE_TRACK_HEIGHT}px` }}
                  >
                    <div
                      className="flex flex-col gap-[10px]"
                      style={{
                        transform: `translateY(${spinTranslate}px)`,
                        transition: spinTransition,
                        willChange: 'transform',
                      }}
                    >
                      {laneGames.map((game, index) => {
                        const isWinnerRow = index === WINNER_ROW_INDEX;
                        return (
                          <div
                            key={`${game.id}-${index}-${centerIndex}`}
                            className={[
                              'relative flex h-[92px] flex-none items-center justify-center rounded-[999px] bg-[#dbdbdb] px-6 text-center transition-all duration-200',
                              isWinnerRow ? 'font-bold text-black' : 'font-semibold text-zinc-500',
                            ].join(' ')}
                          >
                            <span
                              className={[
                                'max-w-full truncate whitespace-nowrap leading-[1.15] transition-all duration-200',
                                isWinnerRow ? 'text-[24px] xl:text-[34px]' : 'text-[19px] xl:text-[28px]',
                              ].join(' ')}
                            >
                              {game.title}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleSpin}
                    disabled={isSpinning || filteredGamesDb.length === 0}
                    className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-black px-5 py-2.5 text-[16px] font-medium text-white transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-80 xl:px-6 xl:py-3 xl:text-[18px]"
                  >
                    {filteredGamesDb.length === 0 ? 'Нет игр по фильтрам' : isSpinning ? 'Крутим...' : 'Мне повезет!'}
                  </button>
                </div>
              </div>
            </main>

            <aside className="flex w-[320px] shrink-0 flex-col rounded-[34px] bg-[#101115] px-6 py-6 xl:w-[360px]">
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="space-y-2.5 xl:space-y-3">
                  {!hasSpun &&
                    rightPlaceholders.map((item) => (
                      <div
                        key={item.id}
                        className="w-full rounded-full bg-white py-2.5 pl-7 pr-4 text-left text-[16px] font-medium text-black xl:py-3 xl:pl-8 xl:pr-5 xl:text-[18px]"
                      >
                        <span className="block truncate leading-[1.15]">&nbsp;</span>
                      </div>
                    ))}

                  {hasSpun &&
                    rightColumnItems.map((game, index) => (
                      <button
                        key={`${game.id}-${index}`}
                        type="button"
                        onClick={() => setSelectedGame(game)}
                        className="w-full truncate whitespace-nowrap rounded-full bg-white py-2.5 pl-7 pr-4 text-left text-[16px] font-medium text-black transition hover:translate-x-1 xl:py-3 xl:pl-8 xl:pr-5 xl:text-[18px]"
                      >
                        <span className="block truncate leading-[1.15]">{game.title}</span>
                      </button>
                    ))}
                </div>
              </div>

              <div className="mt-5 flex justify-start xl:mt-6">
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="inline-flex whitespace-nowrap rounded-full bg-white px-3 py-2.5 text-left text-[16px] font-medium text-black transition-all duration-200 ease-out hover:bg-zinc-100 active:scale-[0.98] xl:px-4 xl:py-3 xl:text-[18px]"
                >
                  <span className="block truncate leading-[1.15]">Настройки</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsHistoryOpen(true)}
                  className="inline-flex whitespace-nowrap rounded-full bg-white px-3 py-2.5 text-left text-[16px] font-medium text-black transition-all duration-200 ease-out hover:bg-zinc-100 active:scale-[0.98] xl:px-4 xl:py-3 xl:text-[18px] ml-3"
                >
                  <span className="block truncate leading-[1.15]">История</span>
                </button>
              </div>
            </aside>
          </div>

          <div
            className={[
              'absolute inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-sm transition-all duration-300 ease-out',
              isSettingsOpen ? 'pointer-events-auto bg-black/45 opacity-100' : 'pointer-events-none bg-black/0 opacity-0',
            ].join(' ')}
          >
            <div
              className={[
                'w-full max-w-[560px] rounded-[32px] bg-[#17191e] p-6 shadow-2xl transition-all duration-300 ease-out xl:p-7',
                isSettingsOpen ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-4 scale-95 opacity-0',
              ].join(' ')}
            >
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="text-[26px] font-semibold leading-[1.12] text-white xl:text-[30px]">Настройки</h2>
                  <p className="mt-1 text-sm leading-[1.2] text-zinc-400">
                    Звук и фильтры рулетки.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="inline-flex h-11 w-11 aspect-square items-center justify-center rounded-full bg-white text-xl leading-none text-black transition-all duration-200 ease-out hover:bg-zinc-100 active:scale-[0.98]"
                >
                  ×
                </button>
              </div>

              <div className="space-y-5">
                <div className="rounded-[26px] bg-[#101115] p-4 xl:p-5">
                  <div className="mb-4 text-[18px] font-medium leading-[1.15] text-white xl:text-[20px]">
                    Настройки звука
                  </div>

                  <div>
                    <div className="mb-4 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[18px] font-medium leading-[1.15] text-white xl:text-[20px]">Громкость</div>
                      </div>
                      <div className="rounded-full bg-white px-4 py-2 text-[16px] font-medium leading-[1.1] text-black xl:text-[18px]">
                        {soundVolume}%
                      </div>
                    </div>

                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={soundVolume}
                      onChange={(event) => setSoundVolume(Number(event.target.value))}
                      className="single-slider h-3 w-full cursor-pointer appearance-none rounded-full"
                      style={{
                        background: `linear-gradient(to right, #22c55e ${soundVolume}%, #52525b ${soundVolume}%)`,
                      }}
                    />
                  </div>
                </div>

                <div className="rounded-[26px] bg-[#101115] p-4 xl:p-5">
                  <div className="mb-4 text-[18px] font-medium leading-[1.15] text-white xl:text-[20px]">
                    Настройки рулетки
                  </div>

                  <div className="space-y-6">
                    <div>
                      <div className="mb-4 flex items-center justify-between gap-4">
                        <div>
                          <div className="text-[18px] font-medium leading-[1.15] text-white xl:text-[20px]">Рейтинг</div>
                        </div>
                        <div className="rounded-full bg-white px-4 py-2 text-[16px] font-medium leading-[1.1] text-black xl:text-[18px]">
                          {ratingMin.toFixed(1)}–{ratingMax.toFixed(1)}
                        </div>
                      </div>

                      <DualRangeSlider
                        min={MIN_RATING}
                        max={MAX_RATING}
                        step={0.1}
                        minValue={ratingMin}
                        maxValue={ratingMax}
                        onMinChange={(value) => setRatingMin(Math.min(value, ratingMax))}
                        onMaxChange={(value) => setRatingMax(Math.max(value, ratingMin))}
                      />
                    </div>

                    <div>
                      <div className="mb-4 flex items-center justify-between gap-4">
                        <div>
                          <div className="text-[18px] font-medium leading-[1.15] text-white xl:text-[20px]">Период</div>
                        </div>
                        <div className="rounded-full bg-white px-4 py-2 text-[16px] font-medium leading-[1.1] text-black xl:text-[18px]">
                          {getPeriodDisplay(periodMinIndex, periodMaxIndex)}
                        </div>
                      </div>

                      <DualRangeSlider
                        min={0}
                        max={PERIOD_BUCKETS.length - 1}
                        step={1}
                        minValue={periodMinIndex}
                        maxValue={periodMaxIndex}
                        onMinChange={(value) => setPeriodMinIndex(Math.min(value, periodMaxIndex))}
                        onMaxChange={(value) => setPeriodMaxIndex(Math.max(value, periodMinIndex))}
                      />
                    </div>

                    <div>
                      <div className="mb-4 flex items-center justify-between gap-4">
                        <div>
                          <div className="text-[18px] font-medium leading-[1.15] text-white xl:text-[20px]">Игр в раунде</div>
                        </div>
                        <div className="rounded-full bg-white px-4 py-2 text-[16px] font-medium leading-[1.1] text-black xl:text-[18px]">
                          {roundSize}
                        </div>
                      </div>

                      <input
                        type="range"
                        min={MIN_ROUND_SIZE}
                        max={MAX_ROUND_SIZE}
                        step={1}
                        value={roundSize}
                        onChange={(event) => setRoundSize(Number(event.target.value))}
                        className="single-slider h-3 w-full cursor-pointer appearance-none rounded-full"
                        style={{
                          background: `linear-gradient(to right, #22c55e ${((roundSize - MIN_ROUND_SIZE) / (MAX_ROUND_SIZE - MIN_ROUND_SIZE)) * 100}%, #52525b ${((roundSize - MIN_ROUND_SIZE) / (MAX_ROUND_SIZE - MIN_ROUND_SIZE)) * 100}%)`,
                        }}
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex-1 rounded-full bg-white px-4 py-3 text-[16px] font-medium text-black xl:text-[18px]">
                        Игр в списке: {filteredGamesDb.length}
                      </div>

                      <button
                        type="button"
                        onClick={resetRouletteSettings}
                        className="inline-flex shrink-0 rounded-full bg-white px-5 py-3 text-[16px] font-medium text-black transition-all duration-200 ease-out hover:bg-zinc-100 active:scale-[0.98] xl:text-[18px]"
                      >
                        Сброс
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <style>{`
                .single-slider::-webkit-slider-thumb {
                  appearance: none;
                  width: 20px;
                  height: 20px;
                  border-radius: 999px;
                  background: #ffffff;
                  cursor: pointer;
                  box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                  border: none;
                  transition: transform 0.15s ease;
                }

                .single-slider::-webkit-slider-thumb:hover {
                  transform: scale(1.1);
                }

                .single-slider::-moz-range-thumb {
                  width: 20px;
                  height: 20px;
                  border-radius: 999px;
                  background: #ffffff;
                  cursor: pointer;
                  border: none;
                  box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                }

                .range-thumb::-webkit-slider-thumb {
                  appearance: none;
                  pointer-events: auto;
                  width: 20px;
                  height: 20px;
                  border-radius: 999px;
                  background: transparent;
                  cursor: pointer;
                  border: none;
                  box-shadow: none;
                  opacity: 0;
                }

                .range-thumb::-moz-range-thumb {
                  pointer-events: auto;
                  width: 20px;
                  height: 20px;
                  border-radius: 999px;
                  background: transparent;
                  cursor: pointer;
                  border: none;
                  box-shadow: none;
                  opacity: 0;
                }
              `}</style>
            </div>
          </div>
        </div>

          <div
            className={[
              'absolute inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-sm transition-all duration-300 ease-out',
              isHistoryOpen ? 'pointer-events-auto bg-black/45 opacity-100' : 'pointer-events-none bg-black/0 opacity-0',
            ].join(' ')}
          >
            <div
              className={[
                'w-full max-w-[560px] rounded-[32px] bg-[#17191e] p-6 shadow-2xl transition-all duration-300 ease-out',
                isHistoryOpen ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-4 scale-95 opacity-0',
              ].join(' ')}
            >
              <div className="mb-4 flex justify-between items-center">
                <h2 className="text-[26px] font-semibold leading-[1.12] text-white xl:text-[30px]">История</h2>
                <button
                  onClick={() => setIsHistoryOpen(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-black"
                >
                  ×
                </button>
              </div>

              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {historyGames.length === 0 && (
                  <div className="text-zinc-400">Пусто</div>
                )}

                {historyGames.map((game, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      setSelectedGame(game);
                      setIsHistoryOpen(false);
                    }}
                    className="w-full text-left bg-white text-black rounded-full px-5 py-3 text-[16px] font-semibold xl:text-[18px]"
                  >
                    {game.title}
                  </button>
                ))}
              
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => {
                    setHistoryGames([]);
                    window.localStorage.removeItem(LS_HISTORY);
                  }}
                  className="inline-flex rounded-full bg-white px-5 py-3 text-[16px] font-medium text-black transition hover:bg-zinc-100 xl:text-[18px]"
                >
                  Очистить историю
                </button>
              </div>

            </div>
          </div>

      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  labelClassName = '',
  valueClassName = '',
}: {
  label: string;
  value: string;
  labelClassName?: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 xl:gap-3">
      <Pill className={labelClassName}>{label}</Pill>
      <Pill className={valueClassName}>{value}</Pill>
    </div>
  );
}

function Pill({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`inline-flex h-[42px] items-center justify-center rounded-full bg-white px-3 text-[16px] font-medium text-black xl:h-[48px] xl:px-4 xl:text-[18px] ${className}`}
    >
      <span className="block truncate leading-[1.15]">{children}</span>
    </div>
  );
}
