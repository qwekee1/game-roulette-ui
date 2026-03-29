import React, { useEffect, useMemo, useRef, useState } from 'react';
import rawDatabase from './data/games_roulette_database_merged.json';

type Difficulty = 'Легкая' | 'Нормальная' | 'Сложная';

type AudioContextCtor = {
  new (): AudioContext;
};

type RawGameEntry = {
  id: number | string;
  name: string;
  url_stopgame: string;
  rating?: number | null;
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
  source?: {
    bucketCodes?: number[];
    normalizedTiers?: number[];
    maxNormalizedTier?: number;
    files?: string[];
  };
  assets?: {
    stopgameCoverUrl?: string | null;
    stopgameCoverFetched?: boolean;
    notes?: string;
  };
};

const database = rawDatabase as RawDatabase;
const DIFFICULTIES: Difficulty[] = ['Легкая', 'Нормальная', 'Сложная'];

const LANE_ITEM_HEIGHT = 92;
const STEP_GAP = 10;
const STEP_DISTANCE = LANE_ITEM_HEIGHT + STEP_GAP;
const VISIBLE_ROWS = 9;
const WINNER_ROW_INDEX = 4;
const SPIN_OVERSHOOT = 22;
const VISIBLE_TRACK_HEIGHT =
  VISIBLE_ROWS * LANE_ITEM_HEIGHT + (VISIBLE_ROWS - 1) * STEP_GAP;
const SPIN_POOL_SIZE = 10;

const MIN_RATING = 0;
const MAX_RATING = 5;
const MIN_YEAR = 1980;
const MAX_YEAR = 2025;

const LS_SOUND_ENABLED = 'soundEnabled';
const LS_SOUND_VOLUME = 'soundVolume';
const LS_RATING_MIN = 'rouletteRatingMin';
const LS_RATING_MAX = 'rouletteRatingMax';
const LS_YEAR_MIN = 'rouletteYearMin';
const LS_YEAR_MAX = 'rouletteYearMax';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

  return {
    id: String(raw.id),
    title: raw.name,
    stopgameUrl: raw.url_stopgame,
    stopgameSlug: raw.url_stopgame.split('/').filter(Boolean).pop(),
    ratingValue: typeof raw.rating === 'number' ? raw.rating : null,
    yearRangeRaw: raw.year_range ?? null,
    yearStart: parsedYears.start,
    yearEnd: parsedYears.end,
    rating: {
      value: raw.rating ?? null,
      text: typeof raw.rating === 'number' ? raw.rating.toFixed(1) : null,
      allObservedValues: typeof raw.rating === 'number' ? [raw.rating.toFixed(1)] : [],
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

function getPeriodText(game: GameEntry | null): string {
  if (!game) return '—';
  return game.period?.label ?? '—';
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
  yearMin: number,
  yearMax: number,
): boolean {
  const rating = game.ratingValue ?? 0;
  if (rating < ratingMin || rating > ratingMax) return false;

  const start = game.yearStart ?? MIN_YEAR;
  const end = game.yearEnd ?? MAX_YEAR;

  return end >= yearMin && start <= yearMax;
}

function readNumberFromStorage(key: string, fallback: number): number {
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  const range = max - min;
  const leftPercent = ((minValue - min) / range) * 100;
  const rightPercent = ((maxValue - min) / range) * 100;

  return (
    <div className="relative h-8">
      <div className="absolute top-1/2 h-3 w-full -translate-y-1/2 rounded-full bg-zinc-600" />
      <div
        className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full bg-emerald-500"
        style={{
          left: `${leftPercent}%`,
          width: `${Math.max(0, rightPercent - leftPercent)}%`,
        }}
      />

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={minValue}
        onChange={(event) => onMinChange(Number(event.target.value))}
        className="range-thumb pointer-events-none absolute left-0 top-1/2 h-8 w-full -translate-y-1/2 appearance-none bg-transparent"
      />

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={maxValue}
        onChange={(event) => onMaxChange(Number(event.target.value))}
        className="range-thumb pointer-events-none absolute left-0 top-1/2 h-8 w-full -translate-y-1/2 appearance-none bg-transparent"
      />
    </div>
  );
}

export default function GameRouletteUI() {
  const [gamesDb] = useState<GameEntry[]>(() => getGamesDb());
  const [spinPool, setSpinPool] = useState<GameEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<GameEntry | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [isDifficultyOpen, setIsDifficultyOpen] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [hasSpun, setHasSpun] = useState(false);
  const [centerIndex, setCenterIndex] = useState(0);
  const [spinTranslate, setSpinTranslate] = useState(0);
  const [spinTransition, setSpinTransition] = useState('none');
  const [spinSequence, setSpinSequence] = useState<GameEntry[] | null>(null);
  const [presetCount, setPresetCount] = useState<number>(0);
  const [isPresetOpen, setIsPresetOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [isSoundEnabled, setIsSoundEnabled] = useState<boolean>(() => {
    const saved = window.localStorage.getItem(LS_SOUND_ENABLED);
    return saved !== null ? JSON.parse(saved) : true;
  });
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
  const [yearMin, setYearMin] = useState<number>(() =>
    clamp(readNumberFromStorage(LS_YEAR_MIN, MIN_YEAR), MIN_YEAR, MAX_YEAR),
  );
  const [yearMax, setYearMax] = useState<number>(() =>
    clamp(readNumberFromStorage(LS_YEAR_MAX, MAX_YEAR), MIN_YEAR, MAX_YEAR),
  );

  const spinTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const settleTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const finalizeTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const tickTimeoutsRef = useRef<Array<ReturnType<typeof window.setTimeout>>>([]);

  const filteredGamesDb = useMemo(() => {
    return gamesDb.filter((game) => matchesFilters(game, ratingMin, ratingMax, yearMin, yearMax));
  }, [gamesDb, ratingMin, ratingMax, yearMin, yearMax]);

  const repeatedSpinPool = useMemo(() => {
    if (spinPool.length === 0) return [];
    return Array.from({ length: 120 }, (_, index) => spinPool[index % spinPool.length]);
  }, [spinPool]);

  useEffect(() => {
    window.localStorage.setItem(LS_SOUND_ENABLED, JSON.stringify(isSoundEnabled));
  }, [isSoundEnabled]);

  useEffect(() => {
    window.localStorage.setItem(LS_SOUND_VOLUME, String(soundVolume));
  }, [soundVolume]);

  useEffect(() => {
    window.localStorage.setItem(LS_RATING_MIN, String(ratingMin));
    window.localStorage.setItem(LS_RATING_MAX, String(ratingMax));
    window.localStorage.setItem(LS_YEAR_MIN, String(yearMin));
    window.localStorage.setItem(LS_YEAR_MAX, String(yearMax));
  }, [ratingMin, ratingMax, yearMin, yearMax]);

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
    if (!isSoundEnabled || soundVolume === 0) return;
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

  const handleSpin = () => {
    if (isSpinning || filteredGamesDb.length === 0) return;

    if (spinTimeoutRef.current !== null) window.clearTimeout(spinTimeoutRef.current);
    if (settleTimeoutRef.current !== null) window.clearTimeout(settleTimeoutRef.current);
    if (finalizeTimeoutRef.current !== null) window.clearTimeout(finalizeTimeoutRef.current);
    clearTickTimeouts();

    const newRoundGames = getRandomGames(filteredGamesDb, SPIN_POOL_SIZE);
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
  const rightPlaceholders = !hasSpun ? getPlaceholderRows(SPIN_POOL_SIZE) : [];

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-[#090a0d] text-white"
      style={{ fontFamily: 'Gilroy, ui-sans-serif, system-ui, sans-serif' }}
    >
      <div className="mx-auto flex h-full w-full max-w-[1728px] items-stretch gap-4 p-4">
        <aside className="flex w-[320px] shrink-0 flex-col rounded-[34px] bg-[#101115] px-6 py-6 xl:w-[360px]">
          <div className="rounded-[30px] bg-[#17191e] p-4">
            <div className="overflow-hidden rounded-[26px] bg-gradient-to-br from-zinc-100 via-zinc-200 to-zinc-300">
              {selectedGame?.assets?.stopgameCoverUrl ? (
                <img src={selectedGame.assets.stopgameCoverUrl} alt={selectedGame.title} className="aspect-square w-full object-cover" />
              ) : (
                <div className="flex aspect-square items-center justify-center bg-[radial-gradient(circle_at_70%_30%,rgba(255,190,92,0.35),transparent_28%),radial-gradient(circle_at_30%_70%,rgba(93,157,255,0.25),transparent_26%),linear-gradient(180deg,#f8f8f8,#dfe6ef)]">
                  <div className="text-center text-zinc-800">
                    <div className="px-4 text-[14px] font-black leading-[1.15] tracking-[0.12em] xl:text-[16px]">
                      {selectedGame?.title?.toUpperCase() ?? ''}
                    </div>
                    <div className="mt-2 whitespace-nowrap text-[10px] font-semibold tracking-[0.38em] text-zinc-600 xl:text-[12px]">
                      {selectedGame ? 'WINNER' : ''}
                    </div>
                    <div className="mt-10 whitespace-nowrap text-xs text-zinc-500 xl:text-sm">
                      {selectedGame ? 'Обложка игры' : ''}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex h-[54px] items-center justify-center pt-4 xl:h-[64px]">
              <div className="w-full truncate pb-1 text-center text-[28px] font-semibold leading-[1.12] tracking-[-0.03em] xl:text-[36px]">
                {selectedGame?.title ?? '\u00A0'}
              </div>
            </div>
          </div>

          <div className="mt-7 space-y-2.5 xl:space-y-3">
            <InfoRow label="Оценка" value={getRatingText(selectedGame)} />
            <InfoRow label="Период" value={getPeriodText(selectedGame)} />
            <InfoRow label="Игр в раунде" value={hasSpun ? String(spinPool.length) : '—'} />
            <InfoRow label="Доступно" value={String(filteredGamesDb.length)} />
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
          <div className="mb-5 flex items-center gap-2.5 xl:mb-6 xl:gap-3">
            <button
              type="button"
              className="min-w-0 flex-1 inline-flex h-[46px] items-center justify-center truncate whitespace-nowrap rounded-full bg-white px-3 text-[16px] font-medium text-black xl:h-[52px] xl:px-4 xl:text-[18px]"
            >
              <span className="block truncate leading-[1.15]">Выбрать пресет игры</span>
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setIsPresetOpen((prev: boolean) => !prev)}
                className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white text-[20px] font-medium text-black transition-all duration-200 ease-out hover:bg-zinc-100 active:scale-[0.98] xl:h-[52px] xl:w-[52px] xl:text-[24px]"
              >
                <span className="leading-[1.1]">{presetCount}</span>
              </button>

              <div
                className={[
                  'absolute right-0 top-[calc(100%+10px)] z-20 origin-top-right rounded-[20px] bg-white p-2 shadow-2xl transition-all duration-200 ease-out',
                  isPresetOpen
                    ? 'pointer-events-auto translate-y-0 scale-100 opacity-100'
                    : 'pointer-events-none -translate-y-2 scale-95 opacity-0',
                ].join(' ')}
              >
                {[0, 1, 2, 3, 4, 5].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => {
                      setPresetCount(num);
                      setIsPresetOpen(false);
                    }}
                    className="block w-full rounded-full px-4 py-2 text-left text-[15px] font-medium leading-[1.15] text-black transition-colors duration-200 hover:bg-zinc-100"
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>
          </div>

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

              <div className="space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[18px] font-medium leading-[1.15] text-white xl:text-[20px]">Звуки</div>
                    <div className="mt-1 text-sm leading-[1.2] text-zinc-400">Тики рулетки и звук победы</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isSoundEnabled}
                    onClick={() => setIsSoundEnabled((prev: boolean) => !prev)}
                    className={[
                      'relative inline-flex h-10 w-[74px] items-center rounded-full transition-all duration-200',
                      isSoundEnabled ? 'bg-emerald-500' : 'bg-zinc-600',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'inline-block h-8 w-8 transform rounded-full bg-white transition-transform duration-200',
                        isSoundEnabled ? 'translate-x-9' : 'translate-x-1',
                      ].join(' ')}
                    />
                  </button>
                </div>

                <div>
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[18px] font-medium leading-[1.15] text-white xl:text-[20px]">Громкость</div>
                      <div className="mt-1 text-sm leading-[1.2] text-zinc-400">Общий уровень звука интерфейса</div>
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
                      <div className="mt-1 text-sm leading-[1.2] text-zinc-400">
                        От {ratingMin.toFixed(1)} до {ratingMax.toFixed(1)}
                      </div>
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
                      <div className="text-[18px] font-medium leading-[1.15] text-white xl:text-[20px]">Годы</div>
                      <div className="mt-1 text-sm leading-[1.2] text-zinc-400">
                        От {yearMin} до {yearMax}
                      </div>
                    </div>
                    <div className="rounded-full bg-white px-4 py-2 text-[16px] font-medium leading-[1.1] text-black xl:text-[18px]">
                      {yearMin}–{yearMax}
                    </div>
                  </div>

                  <DualRangeSlider
                    min={MIN_YEAR}
                    max={MAX_YEAR}
                    step={1}
                    minValue={yearMin}
                    maxValue={yearMax}
                    onMinChange={(value) => setYearMin(Math.min(value, yearMax))}
                    onMaxChange={(value) => setYearMax(Math.max(value, yearMin))}
                  />
                </div>

                <div className="rounded-full bg-white px-4 py-3 text-[16px] font-medium text-black xl:text-[18px]">
                  Игр в списке: {filteredGamesDb.length}
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
            }

            .range-thumb::-webkit-slider-thumb {
              appearance: none;
              pointer-events: auto;
              width: 20px;
              height: 20px;
              border-radius: 999px;
              background: #ffffff;
              cursor: pointer;
              box-shadow: 0 2px 6px rgba(0,0,0,0.3);
              border: none;
              position: relative;
            }

            .range-thumb::-moz-range-thumb {
              pointer-events: auto;
              width: 20px;
              height: 20px;
              border-radius: 999px;
              background: #ffffff;
              cursor: pointer;
              border: none;
              box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            }
          `}</style>
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
    <div className={`inline-flex h-[42px] items-center justify-center rounded-full bg-white px-3 text-[16px] font-medium text-black xl:h-[48px] xl:px-4 xl:text-[18px] ${className}`}>
      <span className="block truncate leading-[1.15]">{children}</span>
    </div>
  );
}
