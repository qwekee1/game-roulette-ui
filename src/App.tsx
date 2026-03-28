import React, { useEffect, useMemo, useRef, useState } from "react";

type Difficulty = "Легкая" | "Нормальная" | "Сложная";

type AudioContextCtor = {
  new (): AudioContext;
};

type RawGameEntry = {
  id: number | string;
  name: string;
  url_stopgame: string;
  rating?: number | null;
  weight?: number | null;
};

type UploadedGamesDatabase = {
  total_games?: number;
  games?: RawGameEntry[];
};

type GameEntry = {
  id: string;
  title: string;
  stopgameUrl: string;
  stopgameSlug?: string;
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

type DbSourceLabel = "window-db" | "window-raw-json" | "localStorage-json" | "fallback";

declare global {
  interface Window {
    __GAMES_ROULETTE_DB__?: GameEntry[];
    __GAMES_ROULETTE_RAW_DB__?: UploadedGamesDatabase | RawGameEntry[];
  }
}

const DIFFICULTIES: Difficulty[] = ["Легкая", "Нормальная", "Сложная"];
const LANE_ITEM_HEIGHT = 92;
const STEP_GAP = 10;
const STEP_DISTANCE = LANE_ITEM_HEIGHT + STEP_GAP;
const VISIBLE_ROWS = 7;
const WINNER_ROW_INDEX = 3;
const SPIN_OVERSHOOT = 22;
const VISIBLE_TRACK_HEIGHT =
  VISIBLE_ROWS * LANE_ITEM_HEIGHT + (VISIBLE_ROWS - 1) * STEP_GAP;
const SPIN_POOL_SIZE = 10;
const LOCAL_STORAGE_SOUND_ENABLED = "soundEnabled";
const LOCAL_STORAGE_SOUND_VOLUME = "soundVolume";
const LOCAL_STORAGE_RAW_DB = "gamesRouletteRawDb";
const REMOTE_DB_PATHS = [
  "/games_roulette_database_merged.json",
  "/data/games_roulette_database_merged.json",
  "./games_roulette_database_merged.json",
  "./data/games_roulette_database_merged.json",
] as const;

const FALLBACK_RAW_GAMES: RawGameEntry[] = [
  { id: 1, name: "Portal 2", url_stopgame: "https://stopgame.ru/game/portal_2", rating: 4.6 },
  { id: 2, name: "The Witcher 3: Wild Hunt", url_stopgame: "https://stopgame.ru/game/witcher_3_wild_hunt", rating: 4.7 },
  { id: 3, name: "Disco Elysium", url_stopgame: "https://stopgame.ru/game/disco_elysium", rating: 4.6 },
  { id: 4, name: "Half-Life 2", url_stopgame: "https://stopgame.ru/game/half_life_2", rating: 4.6 },
  { id: 5, name: "Mass Effect 2", url_stopgame: "https://stopgame.ru/game/mass_effect_2", rating: 4.6 },
  { id: 6, name: "DOOM", url_stopgame: "https://stopgame.ru/game/doom", rating: 4.5 },
  { id: 7, name: "Horizon Walker", url_stopgame: "https://stopgame.ru/game/horizon_walker", rating: 5.0 },
  { id: 8, name: "Garlic", url_stopgame: "https://stopgame.ru/game/garlic", rating: 4.5 },
  { id: 9, name: "Gearbits", url_stopgame: "https://stopgame.ru/game/gearbits", rating: 4.5 },
  { id: 10, name: "Cult of the Lamb: Pilgrim Pack", url_stopgame: "https://stopgame.ru/game/cult_of_the_lamb_pilgrim_pack", rating: 4.7 },
  { id: 11, name: "Silent Hill 2", url_stopgame: "https://stopgame.ru/game/silent_hill_2", rating: 4.7 },
  { id: 12, name: "Red Dead Redemption II", url_stopgame: "https://stopgame.ru/game/red_dead_redemption_2", rating: 4.7 },
  { id: 13, name: "Baldur’s Gate III", url_stopgame: "https://stopgame.ru/game/baldur_s_gate_iii", rating: 4.6 },
  { id: 14, name: "Fallout 2", url_stopgame: "https://stopgame.ru/game/fallout_2", rating: 4.6 },
  { id: 15, name: "Heroes of Might and Magic III: The Restoration of Erathia", url_stopgame: "https://stopgame.ru/game/heroes_of_might_and_magic_3_the_restoration_of_erathia", rating: 4.6 },
];

function toGameEntry(raw: RawGameEntry): GameEntry {
  return {
    id: String(raw.id),
    title: raw.name,
    stopgameUrl: raw.url_stopgame,
    stopgameSlug: raw.url_stopgame.split("/").filter(Boolean).pop(),
    rating: {
      value: raw.rating ?? null,
      text: typeof raw.rating === "number" ? raw.rating.toFixed(1) : null,
      allObservedValues: typeof raw.rating === "number" ? [raw.rating.toFixed(1)] : [],
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
    if (!seen.has(key)) {
      seen.set(key, game);
    }
  }

  return Array.from(seen.values());
}

function isRawGameEntry(value: unknown): value is RawGameEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as RawGameEntry;
  return Boolean(entry.name && entry.url_stopgame && (typeof entry.id === "number" || typeof entry.id === "string"));
}

function normalizeRawDatabase(input: unknown): RawGameEntry[] {
  if (Array.isArray(input) && input.every(isRawGameEntry)) {
    return input;
  }

  if (input && typeof input === "object") {
    const maybeDb = input as UploadedGamesDatabase;
    if (Array.isArray(maybeDb.games) && maybeDb.games.every(isRawGameEntry)) {
      return maybeDb.games;
    }
  }

  return [];
}

function parseJsonSafely(text: string | null): unknown | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function loadGamesDb(): { games: GameEntry[]; source: DbSourceLabel; totalCount: number } {
  if (typeof window !== "undefined" && Array.isArray(window.__GAMES_ROULETTE_DB__)) {
    const games = dedupeGames(window.__GAMES_ROULETTE_DB__);
    if (games.length > 0) {
      return { games, source: "window-db", totalCount: games.length };
    }
  }

  if (typeof window !== "undefined") {
    const rawFromWindow = normalizeRawDatabase(window.__GAMES_ROULETTE_RAW_DB__);
    if (rawFromWindow.length > 0) {
      const games = dedupeGames(rawFromWindow.map(toGameEntry));
      return { games, source: "window-raw-json", totalCount: rawFromWindow.length };
    }

    const rawFromStorage = normalizeRawDatabase(
      parseJsonSafely(window.localStorage.getItem(LOCAL_STORAGE_RAW_DB)),
    );
    if (rawFromStorage.length > 0) {
      const games = dedupeGames(rawFromStorage.map(toGameEntry));
      return { games, source: "localStorage-json", totalCount: rawFromStorage.length };
    }
  }

  const games = dedupeGames(FALLBACK_RAW_GAMES.map(toGameEntry));
  return { games, source: "fallback", totalCount: FALLBACK_RAW_GAMES.length };
}

async function loadRemoteGamesDb(): Promise<{ games: GameEntry[]; totalCount: number } | null> {
  if (typeof window === "undefined") return null;

  for (const path of REMOTE_DB_PATHS) {
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (!response.ok) continue;

      const json = (await response.json()) as UploadedGamesDatabase | RawGameEntry[];
      const rawGames = normalizeRawDatabase(json);
      if (rawGames.length === 0) continue;

      const games = dedupeGames(rawGames.map(toGameEntry));
      if (games.length === 0) continue;

      window.localStorage.setItem(LOCAL_STORAGE_RAW_DB, JSON.stringify(json));
      return { games, totalCount: rawGames.length };
    } catch {
      // try next path
    }
  }

  return null;
}

function getRandomGames(items: GameEntry[], count: number): GameEntry[] {
  if (items.length === 0 || count <= 0) {
    return [];
  }

  const uniqueItems = dedupeGames(items);

  if (uniqueItems.length <= count) {
    return [...uniqueItems];
  }

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
  if (!game) return "—";
  return game.rating?.text ?? game.rating?.value?.toFixed(1) ?? "—";
}

function getPeriodText(game: GameEntry | null): string {
  if (!game) return "—";
  return game.period?.label ?? "—";
}

function getStopgameButtonHref(game: GameEntry | null): string {
  return game?.stopgameUrl ?? "https://stopgame.ru/";
}

function buildSearchUrl(baseUrl: string, query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return baseUrl;
  return `${baseUrl}${encodeURIComponent(trimmed)}`;
}

function getSteamButtonHref(game: GameEntry | null): string {
  return buildSearchUrl("https://store.steampowered.com/search/?term=", game?.title ?? "");
}

function getHltbButtonHref(game: GameEntry | null): string {
  return buildSearchUrl("https://howlongtobeat.com/?q=", game?.title ?? "");
}

function getDbSourceText(source: DbSourceLabel): string {
  if (source === "window-db") return "window.__GAMES_ROULETTE_DB__";
  if (source === "window-raw-json") return "window.__GAMES_ROULETTE_RAW_DB__";
  if (source === "localStorage-json") return "remote/localStorage gamesRouletteRawDb";
  return "fallback demo db";
}

function runSelfTests(): void {
  const sample = dedupeGames([
    toGameEntry({ id: 1, name: "A", url_stopgame: "https://stopgame.ru/game/a", rating: 5 }),
    toGameEntry({ id: 1, name: "A duplicate", url_stopgame: "https://stopgame.ru/game/a", rating: 4 }),
    toGameEntry({ id: 2, name: "B", url_stopgame: "https://stopgame.ru/game/b", rating: 4 }),
  ]);

  console.assert(sample.length === 2, "dedupeGames should remove duplicate stopgameUrl entries");

  const randomTen = getRandomGames(
    Array.from({ length: 20 }, (_, index) =>
      toGameEntry({
        id: index + 1,
        name: `Game ${index + 1}`,
        url_stopgame: `https://stopgame.ru/game/game_${index + 1}`,
        rating: 4.5,
      }),
    ),
    10,
  );

  console.assert(randomTen.length === 10, "getRandomGames should return exactly 10 entries when available");

  const visible = buildVisibleGames(randomTen, 0);
  console.assert(visible.length === VISIBLE_ROWS, "buildVisibleGames should return VISIBLE_ROWS items");

  const normalizedObjectDb = normalizeRawDatabase({
    total_games: 2,
    games: [
      { id: 1, name: "One", url_stopgame: "https://stopgame.ru/game/one", rating: 5 },
      { id: 2, name: "Two", url_stopgame: "https://stopgame.ru/game/two", rating: 4 },
    ],
  });
  console.assert(normalizedObjectDb.length === 2, "normalizeRawDatabase should read object databases");

  const sequence = buildSpinSequence(randomTen, 0, 15);
  console.assert(sequence.length === 22, "buildSpinSequence should create a stable render sequence");
}

runSelfTests();

export default function GameRouletteUI() {
  const initialDbState = useMemo(() => loadGamesDb(), []);
  const [gamesDb, setGamesDb] = useState<GameEntry[]>(() => initialDbState.games);
  const [dbSource, setDbSource] = useState<DbSourceLabel>(initialDbState.source);
  const [dbTotalCount, setDbTotalCount] = useState<number>(initialDbState.totalCount);
  const [spinPool, setSpinPool] = useState<GameEntry[]>(() =>
    getRandomGames(initialDbState.games, SPIN_POOL_SIZE),
  );
  const [selectedGame, setSelectedGame] = useState<GameEntry | null>(() => null);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [isDifficultyOpen, setIsDifficultyOpen] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [centerIndex, setCenterIndex] = useState(0);
  const [spinTranslate, setSpinTranslate] = useState(0);
  const [spinTransition, setSpinTransition] = useState("none");
  const [spinSequence, setSpinSequence] = useState<GameEntry[] | null>(null);
  const [presetCount, setPresetCount] = useState<number>(0);
  const [isPresetOpen, setIsPresetOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSoundEnabled, setIsSoundEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const saved = window.localStorage.getItem(LOCAL_STORAGE_SOUND_ENABLED);
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [soundVolume, setSoundVolume] = useState<number>(() => {
    if (typeof window === "undefined") return 70;
    const saved = window.localStorage.getItem(LOCAL_STORAGE_SOUND_VOLUME);
    return saved !== null ? Number(saved) : 70;
  });

  const spinTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const settleTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const tickTimeoutsRef = useRef<Array<ReturnType<typeof window.setTimeout>>>([]);

  const repeatedSpinPool = useMemo(() => {
    const base = spinPool.length > 0 ? spinPool : gamesDb.slice(0, SPIN_POOL_SIZE);
    if (base.length === 0) return [];
    return Array.from({ length: 80 }, (_, index) => base[index % base.length]);
  }, [gamesDb, spinPool]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCAL_STORAGE_SOUND_ENABLED, JSON.stringify(isSoundEnabled));
    }
  }, [isSoundEnabled]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCAL_STORAGE_SOUND_VOLUME, String(soundVolume));
    }
  }, [soundVolume]);

  useEffect(() => {
    let isCancelled = false;

    void loadRemoteGamesDb().then((remoteDb) => {
      if (isCancelled || !remoteDb || remoteDb.games.length === 0) return;

      setGamesDb(remoteDb.games);
      setDbSource("localStorage-json");
      setDbTotalCount(remoteDb.totalCount);
      setSpinPool(getRandomGames(remoteDb.games, SPIN_POOL_SIZE));
      setSpinSequence(null);
      setSpinTransition("none");
      setSpinTranslate(0);
      setCenterIndex(0);
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (spinPool.length > 0) {
      setSelectedGame(spinPool[0]);
      setCenterIndex(0);
    }
  }, [spinPool]);

  useEffect(() => {
    return () => {
      if (spinTimeoutRef.current !== null) {
        window.clearTimeout(spinTimeoutRef.current);
      }
      if (settleTimeoutRef.current !== null) {
        window.clearTimeout(settleTimeoutRef.current);
      }
      tickTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      tickTimeoutsRef.current = [];
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        void audioContextRef.current.close();
      }
    };
  }, []);

  const visibleGames = useMemo(() => {
    if (repeatedSpinPool.length === 0) return [];
    return buildVisibleGames(repeatedSpinPool, centerIndex);
  }, [centerIndex, repeatedSpinPool]);

  const laneGames = spinSequence ?? visibleGames;

  const getAudioContext = () => {
    if (typeof window === "undefined") return null;

    const audioWindow = window as Window & { webkitAudioContext?: AudioContextCtor };
    const AudioContextClass: AudioContextCtor | undefined =
      window.AudioContext ?? audioWindow.webkitAudioContext;

    if (!AudioContextClass) return null;

    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContextClass();
    }

    if (audioContextRef.current.state === "suspended") {
      void audioContextRef.current.resume();
    }

    return audioContextRef.current;
  };

  const playTone = (
    frequency: number,
    durationMs: number,
    volume: number,
    type: OscillatorType,
  ) => {
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
        const noteDuration =
          progress < 0.6 ? 22 : progress < 0.8 ? 40 : progress < 0.9 ? 70 : 120;

        playTone(pitch, noteDuration, volume, "square");
      }, Math.max(0, Math.round(time)));

      tickTimeoutsRef.current.push(timeoutId);
    });
  };

  const playWinSound = () => {
    playTone(523.25, 160, 0.05, "triangle");
    window.setTimeout(() => playTone(659.25, 180, 0.05, "triangle"), 120);
    window.setTimeout(() => playTone(783.99, 260, 0.06, "triangle"), 250);
  };

  const handleSpin = () => {
    if (isSpinning || gamesDb.length === 0) return;

    if (spinTimeoutRef.current !== null) {
      window.clearTimeout(spinTimeoutRef.current);
    }
    if (settleTimeoutRef.current !== null) {
      window.clearTimeout(settleTimeoutRef.current);
    }
    clearTickTimeouts();

    const newRoundGames = getRandomGames(gamesDb, SPIN_POOL_SIZE);
    if (newRoundGames.length === 0) return;

    const repeatedPool = Array.from(
      { length: Math.max(80, newRoundGames.length * 8) },
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

    setSpinPool(newRoundGames);
    setSelectedGame(newRoundGames[0]);
    setCenterIndex(spinStartIndex);
    setIsSpinning(true);
    setSpinSequence(sequence);
    setSpinTransition("none");
    setSpinTranslate(0);
    startTickSound(totalSteps, duration);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSpinTransition(`transform ${duration}ms cubic-bezier(0.16, 0.84, 0.24, 1)`);
        setSpinTranslate(-(totalSteps * STEP_DISTANCE + SPIN_OVERSHOOT));
      });
    });

    spinTimeoutRef.current = window.setTimeout(() => {
      setSpinTransition("transform 900ms cubic-bezier(0.25, 1, 0.5, 1)");
      setSpinTranslate(-(totalSteps * STEP_DISTANCE));

      settleTimeoutRef.current = window.setTimeout(() => {
        setCenterIndex(winnerIndex);
        setSelectedGame(winner);
        setSpinSequence(null);

        requestAnimationFrame(() => {
          setSpinTransition("none");
          setSpinTranslate(0);
        });

        clearTickTimeouts();
        playWinSound();
        setIsSpinning(false);
      }, 900);
    }, duration);
  };

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-[#090a0d] text-white"
      style={{ fontFamily: "Gilroy, ui-sans-serif, system-ui, sans-serif" }}
    >
      <div className="mx-auto flex h-full w-full max-w-[1728px] items-stretch gap-4 p-4">
        <aside className="flex w-[320px] shrink-0 flex-col rounded-[34px] bg-[#101115] px-6 py-6 xl:w-[360px]">
          <div className="rounded-[30px] bg-[#17191e] p-4">
            <div className="overflow-hidden rounded-[26px] bg-gradient-to-br from-zinc-100 via-zinc-200 to-zinc-300">
              {selectedGame?.assets?.stopgameCoverUrl ? (
                <img
                  src={selectedGame.assets.stopgameCoverUrl}
                  alt={selectedGame.title}
                  className="aspect-square w-full object-cover"
                />
              ) : (
                <div className="flex aspect-square items-center justify-center bg-[radial-gradient(circle_at_70%_30%,rgba(255,190,92,0.35),transparent_28%),radial-gradient(circle_at_30%_70%,rgba(93,157,255,0.25),transparent_26%),linear-gradient(180deg,#f8f8f8,#dfe6ef)]">
                  <div className="text-center leading-tight text-zinc-800">
                    <div className="px-4 text-[14px] font-black tracking-[0.12em] xl:text-[16px]">
                      {selectedGame?.title?.toUpperCase() ?? "WINNER"}
                    </div>
                    <div className="mt-2 whitespace-nowrap text-[10px] font-semibold tracking-[0.38em] text-zinc-600 xl:text-[12px]">
                      WINNER
                    </div>
                    <div className="mt-10 whitespace-nowrap text-xs text-zinc-500 xl:text-sm">
                      Обложка игры
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="truncate pb-1 pt-4 text-center text-[28px] font-semibold leading-none tracking-[-0.03em] xl:text-[36px]">
              {selectedGame?.title ?? "—"}
            </div>
            
          </div>

          <div className="mt-7 space-y-2.5 xl:space-y-3">
            <InfoRow label="Оценка" value={getRatingText(selectedGame)} />
            <InfoRow label="Период" value={getPeriodText(selectedGame)} />

            <div className="flex items-center gap-2.5 xl:gap-3">
              <Pill>Сложность</Pill>
              <div className="relative min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setIsDifficultyOpen((prev: boolean) => !prev)}
                  className="relative inline-flex h-[42px] items-center rounded-full bg-white px-3 text-left text-[16px] font-medium text-black transition-all duration-200 ease-out hover:bg-zinc-100 active:scale-[0.98] xl:h-[48px] xl:px-4 xl:text-[18px]"
                >
                  <span className="block truncate">{difficulty ?? "Выбрать"}</span>
                </button>

                <div
                  className={[
                    "absolute left-0 right-0 top-[calc(100%+10px)] z-20 origin-top rounded-[24px] bg-white p-2 shadow-2xl transition-all duration-200 ease-out",
                    isDifficultyOpen
                      ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                      : "pointer-events-none -translate-y-2 scale-95 opacity-0",
                  ].join(" ")}
                >
                  {DIFFICULTIES.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setDifficulty(item);
                        setIsDifficultyOpen(false);
                      }}
                      className="w-full rounded-full px-5 py-2.5 text-left text-[15px] font-medium text-black transition-colors duration-200 hover:bg-zinc-100 xl:px-6 xl:py-3 xl:text-[16px]"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <InfoRow label="Игр в раунде" value={String(spinPool.length)} />
          </div>

          <div className="mt-auto pt-5">
            <div className="flex flex-wrap gap-2.5 xl:gap-3">
              {[
                { label: "SG", href: getStopgameButtonHref(selectedGame) },
                { label: "Steam", href: getSteamButtonHref(selectedGame) },
                { label: "HLTB", href: getHltbButtonHref(selectedGame) },
              ].map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-[42px] items-center justify-center rounded-full bg-white px-3 text-[16px] font-medium text-black transition-all duration-200 ease-out hover:bg-zinc-100 active:scale-[0.98] xl:h-[48px] xl:px-4 xl:text-[18px]"
                >
                  <span className="block truncate">{item.label}</span>
                </a>
              ))}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 rounded-[34px] bg-[#ececec] p-3">
          <div className="relative flex h-full min-h-0 flex-col rounded-[30px] bg-[#ececec] px-1 pb-[84px] pt-1 xl:pb-[96px]">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-[28px]">
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
                    willChange: "transform",
                  }}
                >
                  {laneGames.map((game, index) => {
                    const isWinnerRow = index === WINNER_ROW_INDEX;

                    return (
                      <div
                        key={`${game.id}-${index}-${centerIndex}-${spinSequence ? "spin" : "idle"}`}
                        className={[
                          "relative flex h-[92px] flex-none items-center justify-center rounded-[999px] bg-[#dbdbdb] px-6 text-center",
                          isWinnerRow ? "font-bold text-black" : "font-semibold text-zinc-500",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "max-w-full truncate whitespace-nowrap leading-none",
                            isWinnerRow ? "text-[24px] xl:text-[34px]" : "text-[19px] xl:text-[28px]",
                          ].join(" ")}
                        >
                          {game.title}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSpin}
              disabled={isSpinning || gamesDb.length === 0}
              className="absolute bottom-5 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-black px-5 py-2.5 text-[16px] font-medium text-white transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-80 xl:bottom-6 xl:px-6 xl:py-3 xl:text-[18px]"
            >
              {isSpinning ? "Крутим..." : "Мне повезет!"}
            </button>
          </div>
        </main>

        <aside className="flex w-[320px] shrink-0 flex-col rounded-[34px] bg-[#101115] px-6 py-6 xl:w-[360px]">
          <div className="mb-5 flex items-center gap-2.5 xl:mb-6 xl:gap-3">
            <button
              type="button"
              className="min-w-0 flex-1 inline-flex h-[46px] items-center justify-center truncate whitespace-nowrap rounded-full bg-white px-3 text-[16px] font-medium text-black xl:h-[52px] xl:px-4 xl:text-[18px]"
            >
              Выбрать пресет игры
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setIsPresetOpen((prev: boolean) => !prev)}
                className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white text-[20px] font-medium text-black transition-all duration-200 ease-out hover:bg-zinc-100 active:scale-[0.98] xl:h-[52px] xl:w-[52px] xl:text-[24px]"
              >
                {presetCount}
              </button>

              <div
                className={[
                  "absolute right-0 top-[calc(100%+10px)] z-20 origin-top-right rounded-[20px] bg-white p-2 shadow-2xl transition-all duration-200 ease-out",
                  isPresetOpen
                    ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                    : "pointer-events-none -translate-y-2 scale-95 opacity-0",
                ].join(" ")}
              >
                {[0, 1, 2, 3, 4, 5].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => {
                      setPresetCount(num);
                      setIsPresetOpen(false);
                    }}
                    className="block w-full rounded-full px-4 py-2 text-left text-[15px] font-medium text-black transition-colors duration-200 hover:bg-zinc-100"
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="space-y-2.5 xl:space-y-3">
              {spinPool.map((game, index) => (
                <button
                  key={`${game.id}-${index}`}
                  type="button"
                  onClick={() => setSelectedGame(game)}
                  className="w-full truncate whitespace-nowrap rounded-full bg-white py-2.5 pl-7 pr-4 text-left text-[16px] font-medium text-black transition hover:translate-x-1 xl:py-3 xl:pl-8 xl:pr-5 xl:text-[18px]"
                >
                  {game.title}
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
              Настройки
            </button>
          </div>
        </aside>
      </div>

      <div
        className={[
          "absolute inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-sm transition-all duration-300 ease-out",
          isSettingsOpen
            ? "pointer-events-auto bg-black/45 opacity-100"
            : "pointer-events-none bg-black/0 opacity-0",
        ].join(" ")}
      >
        <div
          className={[
            "w-full max-w-[460px] rounded-[32px] bg-[#17191e] p-6 shadow-2xl transition-all duration-300 ease-out xl:p-7",
            isSettingsOpen
              ? "translate-y-0 scale-100 opacity-100"
              : "translate-y-4 scale-95 opacity-0",
          ].join(" ")}
        >
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-[26px] font-semibold text-white xl:text-[30px]">Настройки</h2>
              <p className="mt-1 text-sm text-zinc-400 xl:text-base">
                Пока здесь только звук. Фильтры по годам и рейтингу добавим позже.
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
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[18px] font-medium text-white xl:text-[20px]">Звуки</div>
                  <div className="mt-1 text-sm text-zinc-400">Тики рулетки и звук победы</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isSoundEnabled}
                  onClick={() => setIsSoundEnabled((prev: boolean) => !prev)}
                  className={[
                    "relative inline-flex h-10 w-[74px] items-center rounded-full transition-all duration-200",
                    isSoundEnabled ? "bg-emerald-500" : "bg-zinc-600",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "inline-block h-8 w-8 transform rounded-full bg-white transition-transform duration-200",
                      isSoundEnabled ? "translate-x-9" : "translate-x-1",
                    ].join(" ")}
                  />
                </button>
              </div>
            </div>

            <div className="rounded-[26px] bg-[#101115] p-4 xl:p-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-[18px] font-medium text-white xl:text-[20px]">Громкость</div>
                  <div className="mt-1 text-sm text-zinc-400">Общий уровень звука интерфейса</div>
                </div>
                <div className="rounded-full bg-white px-4 py-2 text-[16px] font-medium text-black xl:text-[18px]">
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
                className="slider h-3 w-full cursor-pointer appearance-none rounded-full"
                style={{
                  background: `linear-gradient(to right, #22c55e ${soundVolume}%, #52525b ${soundVolume}%)`,
                }}
              />

              <style>{`
                .slider::-webkit-slider-thumb {
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

                .slider::-webkit-slider-thumb:hover {
                  transform: scale(1.1);
                }

                .slider::-moz-range-thumb {
                  width: 20px;
                  height: 20px;
                  border-radius: 999px;
                  background: #ffffff;
                  cursor: pointer;
                  border: none;
                }
              `}</style>
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
  labelClassName = "",
  valueClassName = "",
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

function Pill({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex h-[42px] items-center justify-center rounded-full bg-white px-3 text-[16px] font-medium text-black xl:h-[48px] xl:px-4 xl:text-[18px] ${className}`}
    >
      <span className="block truncate">{children}</span>
    </div>
  );
}

export {
  buildSpinSequence,
  buildVisibleGames,
  getRandomGames,
  loadGamesDb,
  normalizeRawDatabase,
  dedupeGames,
};
