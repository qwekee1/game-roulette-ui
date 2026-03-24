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

  const spinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const repeatedGames = useMemo(() => {
    return Array.from({ length: 60 }, (_, i) => games[i % games.length]);
  }, [games]);

  useEffect(() => {
    return () => {
      if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
      if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
    };
  }, []);

  const visibleGames = useMemo(() => {
    return buildVisibleGames(repeatedGames, centerIndex);
  }, [centerIndex, repeatedGames]);

  const laneGames = spinSequence ?? visibleGames;

  const handleSpin = () => {
    if (isSpinning) return;

    if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
    if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);

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

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSpinTransition(
          `transform ${duration}ms cubic-bezier(0.16, 0.84, 0.24, 1)`,
        );
        setSpinTranslate(-(totalSteps * STEP_DISTANCE + SPIN_OVERSHOOT));
      });
    });

    spinTimeoutRef.current = setTimeout(() => {
      setSpinTransition("transform 900ms cubic-bezier(0.25, 1, 0.5, 1)");
      setSpinTranslate(-(totalSteps * STEP_DISTANCE));

      settleTimeoutRef.current = setTimeout(() => {
        setCenterIndex(winnerIndex);
        setSelectedGame(winner);
        setSpinSequence(null);

        requestAnimationFrame(() => {
          setSpinTransition("none");
          setSpinTranslate(0);
        });

        setIsSpinning(false);
      }, 900);
    }, duration);
  };

  return (
    <div
      className="h-screen w-screen overflow-hidden bg-[#090a0d] text-white"
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
              {["SG", "Steam", "HLTB"].map((tag) => {
                if (tag === "SG") {
                  return (
                    <a
                      key={tag}
                      href="https://stopgame.ru/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-[42px] items-center justify-center rounded-full bg-white px-3 text-[16px] font-medium text-black transition-all duration-200 ease-out hover:bg-zinc-100 active:scale-[0.98] xl:h-[48px] xl:px-4 xl:text-[18px]"
                    >
                      <span className="block truncate">{tag}</span>
                    </a>
                  );
                }

                if (tag === "Steam") {
                  return (
                    <a
                      key={tag}
                      href="https://store.steampowered.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-[42px] items-center justify-center rounded-full bg-white px-3 text-[16px] font-medium text-black transition-all duration-200 ease-out hover:bg-zinc-100 active:scale-[0.98] xl:h-[48px] xl:px-4 xl:text-[18px]"
                    >
                      <span className="block truncate">{tag}</span>
                    </a>
                  );
                }

                if (tag === "HLTB") {
                  return (
                    <a
                      key={tag}
                      href="https://howlongtobeat.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-[42px] items-center justify-center rounded-full bg-white px-3 text-[16px] font-medium text-black transition-all duration-200 ease-out hover:bg-zinc-100 active:scale-[0.98] xl:h-[48px] xl:px-4 xl:text-[18px]"
                    >
                      <span className="block truncate">{tag}</span>
                    </a>
                  );
                }

                return <Pill key={tag}>{tag}</Pill>;
              })}
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

          <div className="mt-5 flex justify-start gap-3 xl:mt-6 xl:gap-4">
            <button
              type="button"
              className="inline-flex whitespace-nowrap rounded-full bg-white px-3 py-2.5 text-left text-[16px] font-medium text-black xl:px-4 xl:py-3 xl:text-[18px]"
            >
              Рулетка
            </button>
            <button
              type="button"
              className="inline-flex whitespace-nowrap rounded-full bg-white px-3 py-2.5 text-left text-[16px] font-medium text-black xl:px-4 xl:py-3 xl:text-[18px]"
            >
              Настройки
            </button>
          </div>
        </aside>
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
