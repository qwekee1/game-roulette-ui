import React, { useEffect, useMemo, useRef, useState } from "react";

const PRESET_GAMES = [
  "Overwatch",
  "Dota 2",
  "GTA VI",
  "Escape From Tarkov",
  "Call of Duty: Black Ops 7",
  "Minecraft",
  "Counter-Strike 2",
  "Resident Evil",
  "Rust",
  "Fortnite",
];

const DIFFICULTIES = ["Легкая", "Нормальная", "Сложная"] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

type AudioContextCtor = {
  new (): AudioContext;
};

const LANE_ITEM_HEIGHT = 92;
const STEP_GAP = 10;
const STEP_DISTANCE = LANE_ITEM_HEIGHT + STEP_GAP;
const VISIBLE_ROWS = 7;
const WINNER_ROW_INDEX = 3;
const SPIN_OVERSHOOT = 22;
const VISIBLE_TRACK_HEIGHT =
  VISIBLE_ROWS * LANE_ITEM_HEIGHT + (VISIBLE_ROWS - 1) * STEP_GAP;

function buildVisibleGames(source: string[], centerIndex: number): string[] {
  const items: string[] = [];
  const total = source.length;

  for (
    let offset = -WINNER_ROW_INDEX;
    offset < VISIBLE_ROWS - WINNER_ROW_INDEX;
    offset += 1
  ) {
    const index = (centerIndex + offset + total) % total;
    items.push(source[index]);
  }

  return items;
}

function buildSpinSequence(
  source: string[],
  centerIndex: number,
  totalSteps: number,
): string[] {
  const sequence: string[] = [];

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

export default function GameRouletteUI() {
  const [games] = useState(PRESET_GAMES);
  const [selectedGame, setSelectedGame] = useState("Overwatch");
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [isDifficultyOpen, setIsDifficultyOpen] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [centerIndex, setCenterIndex] = useState(0);
  const [spinTranslate, setSpinTranslate] = useState(0);
  const [spinTransition, setSpinTransition] = useState("none");
  const [spinSequence, setSpinSequence] = useState<string[] | null>(null);
  const [presetCount, setPresetCount] = useState<number>(0);
  const [isPresetOpen, setIsPresetOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSoundEnabled, setIsSoundEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState(70);

  const spinTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const settleTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const tickTimeoutsRef = useRef<Array<ReturnType<typeof window.setTimeout>>>([]);

  const repeatedGames = useMemo(() => {
    return Array.from({ length: 60 }, (_, i) => games[i % games.length]);
  }, [games]);

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
    return buildVisibleGames(repeatedGames, centerIndex);
  }, [centerIndex, repeatedGames]);

  const laneGames = spinSequence ?? visibleGames;

  const getAudioContext = () => {
    if (typeof window === "undefined") {
      return null;
    }

    const audioWindow = window as Window & {
      webkitAudioContext?: AudioContextCtor;
    };
    const AudioContextClass: AudioContextCtor | undefined =
      window.AudioContext ?? audioWindow.webkitAudioContext;

    if (!AudioContextClass) {
      return null;
    }

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
    if (!isSoundEnabled || soundVolume === 0) {
      return;
    }

    const ctx = getAudioContext();
    if (!ctx) {
      return;
    }

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
      if (index === 0) {
        return Math.max(12, time * 0.25);
      }

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
        const durationMs =
          progress < 0.6 ? 22 : progress < 0.8 ? 40 : progress < 0.9 ? 70 : 120;

        playTone(pitch, durationMs, volume, "square");
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
    if (isSpinning) {
      return;
    }

    if (spinTimeoutRef.current !== null) {
      window.clearTimeout(spinTimeoutRef.current);
    }
    if (settleTimeoutRef.current !== null) {
      window.clearTimeout(settleTimeoutRef.current);
    }
    clearTickTimeouts();

    const extraLoops = 3;
    const randomExtra = Math.floor(Math.random() * games.length);
    const totalSteps = games.length * extraLoops + randomExtra;
    const winnerIndex = (centerIndex + totalSteps) % repeatedGames.length;
    const winner = repeatedGames[winnerIndex];
    const duration = 5600 + totalSteps * 70;
    const sequence = buildSpinSequence(repeatedGames, centerIndex, totalSteps);

    setIsSpinning(true);
    setSpinSequence(sequence);
    setSpinTransition("none");
    setSpinTranslate(0);
    startTickSound(totalSteps, duration);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSpinTransition(
          `transform ${duration}ms cubic-bezier(0.16, 0.84, 0.24, 1)`,
        );
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
              <div className="flex aspect-square items-center justify-center bg-[radial-gradient(circle_at_70%_30%,rgba(255,190,92,0.35),transparent_28%),radial-gradient(circle_at_30%_70%,rgba(93,157,255,0.25),transparent_26%),linear-gradient(180deg,#f8f8f8,#dfe6ef)]">
                <div className="text-center leading-tight text-zinc-800">
                  <div className="whitespace-nowrap text-[14px] font-black tracking-[0.18em] xl:text-[16px]">
                    {selectedGame.toUpperCase()}
                  </div>
                  <div className="mt-2 whitespace-nowrap text-[10px] font-semibold tracking-[0.38em] text-zinc-600 xl:text-[12px]">
                    WINNER
                  </div>
                  <div className="mt-10 whitespace-nowrap text-xs text-zinc-500 xl:text-sm">
                    Обложка игры
                  </div>
                </div>
              </div>
            </div>

            <div className="truncate pb-1 pt-4 text-center text-[28px] font-semibold leading-none tracking-[-0.03em] xl:text-[36px]">
              {selectedGame}
            </div>
          </div>

          <div className="mt-7 space-y-2.5 xl:space-y-3">
            <InfoRow label="Оценка" value="4.7" />
            <InfoRow label="Время прохождения" value="13ч" />

            <div className="flex items-center gap-2.5 xl:gap-3">
              <Pill>Сложность</Pill>
              <div className="relative min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setIsDifficultyOpen((prev) => !prev)}
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

            <InfoRow label="GGP" value="87" />
          </div>

          <div className="mt-auto pt-5">
            <div className="flex flex-wrap gap-2.5 xl:gap-3">
              {[
                { label: "SG", href: "https://stopgame.ru/" },
                { label: "Steam", href: "https://store.steampowered.com/" },
                { label: "HLTB", href: "https://howlongtobeat.com/" },
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
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="text-[#ff1e68]"
                    >
                      <path d="M9 6c0-.6.7-.9 1.2-.5l7 5c.5.3.5 1 0 1.4l-7 5c-.5.4-1.2 0-1.2-.6V6z" />
                    </svg>
                  </div>

                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="text-[#ff1e68]"
                    >
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
                        key={`${game}-${index}-${centerIndex}-${spinSequence ? "spin" : "idle"}`}
                        className={[
                          "relative flex h-[92px] flex-none items-center justify-center rounded-[999px] bg-[#dbdbdb] px-6 text-center",
                          isWinnerRow
                            ? "font-bold text-black"
                            : "font-semibold text-zinc-500",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "max-w-full truncate whitespace-nowrap leading-none",
                            isWinnerRow
                              ? "text-[24px] xl:text-[34px]"
                              : "text-[19px] xl:text-[28px]",
                          ].join(" ")}
                        >
                          {game}
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
              disabled={isSpinning}
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
                onClick={() => setIsPresetOpen((prev) => !prev)}
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
              {games.map((game) => (
                <button
                  key={game}
                  type="button"
                  onClick={() => setSelectedGame(game)}
                  className="w-full truncate whitespace-nowrap rounded-full bg-white pl-7 pr-4 py-2.5 text-left text-[16px] font-medium text-black transition hover:translate-x-1 xl:pl-8 xl:pr-5 xl:py-3 xl:text-[18px]"
                >
                  {game}
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
              <h2 className="text-[26px] font-semibold text-white xl:text-[30px]">
                Настройки
              </h2>
              <p className="mt-1 text-sm text-zinc-400 xl:text-base">
                Управление звуками рулетки
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsSettingsOpen(false)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-xl font-medium text-black transition-all duration-200 ease-out hover:bg-zinc-100 active:scale-[0.98]"
            >
              ×
            </button>
          </div>

          <div className="space-y-5">
            <div className="rounded-[26px] bg-[#101115] p-4 xl:p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[18px] font-medium text-white xl:text-[20px]">
                    Звуки
                  </div>
                  <div className="mt-1 text-sm text-zinc-400">
                    Тики рулетки и звук победы
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isSoundEnabled}
                  onClick={() => setIsSoundEnabled((prev) => !prev)}
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
                  <div className="text-[18px] font-medium text-white xl:text-[20px]">
                    Громкость
                  </div>
                  <div className="mt-1 text-sm text-zinc-400">
                    Общий уровень звука интерфейса
                  </div>
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

export { buildSpinSequence, buildVisibleGames };
