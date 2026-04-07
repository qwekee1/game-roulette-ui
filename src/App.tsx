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
  };
  assets?: {
    stopgameCoverUrl?: string | null;
    stopgameCoverFetched?: boolean;
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
const VISIBLE_TRACK_HEIGHT = VISIBLE_ROWS * LANE_ITEM_HEIGHT + (VISIBLE_ROWS - 1) * STEP_GAP;

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
const THUMB_SIZE_PX = 20;

// Utility functions
function clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }

function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = value.trim().replace(',', '.').replace(/[^\d.-]/g, '');
    if (!n) return null;
    const p = Number(n);
    return Number.isFinite(p) ? p : null;
  }
  return null;
}

function parseYearRange(yearRange?: string | null) {
  if (!yearRange) return { start: null, end: null };
  const match = yearRange.match(/(\d{4})\D+(\d{4})/);
  if (match) return { start: Math.min(Number(match[1]), Number(match[2])), end: Math.max(Number(match[1]), Number(match[2])) };
  const single = yearRange.match(/(\d{4})/);
  if (single) return { start: Number(single[1]), end: Number(single[1]) };
  return { start: null, end: null };
}

function toGameEntry(raw: RawGameEntry): GameEntry {
  const years = parseYearRange(raw.year_range);
  const rating = parseNumericValue(raw.rating) ?? 0;
  return {
    id: String(raw.id),
    title: raw.name,
    stopgameUrl: raw.url_stopgame,
    stopgameSlug: raw.url_stopgame.split('/').filter(Boolean).pop(),
    ratingValue: rating,
    ratingHltbValue: parseNumericValue(raw.rating_hltb) ?? 0,
    hoursValue: parseNumericValue(raw.hours) ?? 0,
    yearRangeRaw: raw.year_range ?? null,
    yearStart: years.start,
    yearEnd: years.end,
    rating: { value: rating, text: rating.toFixed(1) },
    assets: { stopgameCoverUrl: null, stopgameCoverFetched: false },
  };
}

function dedupeGames(items: GameEntry[]): GameEntry[] {
  const seen = new Map();
  items.forEach(g => { const k = (g.stopgameUrl || g.id).toLowerCase(); if (!seen.has(k)) seen.set(k, g); });
  return Array.from(seen.values());
}

async function fetchStopgameCover(stopgameUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/stopgame-cover?url=${encodeURIComponent(stopgameUrl)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.imageUrl ?? null;
  } catch { return null; }
}

// Sub-components
function DualRangeSlider({ min, max, step, minValue, maxValue, onMinChange, onMaxChange }: RangeSliderProps) {
  const [active, setActive] = useState<ActiveThumb>('max');
  const range = max - min || 1;
  const lp = ((minValue - min) / range) * 100;
  const rp = ((maxValue - min) / range) * 100;

  return (
    <div className="relative h-8">
      <div className="absolute top-1/2 h-3 w-full -translate-y-1/2 rounded-full bg-zinc-600" />
      <div className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full bg-emerald-500" style={{ left: `${lp}%`, width: `${rp - lp}%` }} />
      <div className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-md" style={{ left: `calc(${lp}% - 10px)`, zIndex: active === 'min' ? 40 : 20 }} />
      <div className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-md" style={{ left: `calc(${rp}% - 10px)`, zIndex: active === 'max' ? 40 : 20 }} />
      <input type="range" min={min} max={max} step={step} value={minValue} onChange={e => { setActive('min'); onMinChange(Number(e.target.value)); }} className="range-thumb absolute w-full h-8 opacity-0 z-30 cursor-pointer" />
      <input type="range" min={min} max={max} step={step} value={maxValue} onChange={e => { setActive('max'); onMaxChange(Number(e.target.value)); }} className="range-thumb absolute w-full h-8 opacity-0 z-30 cursor-pointer" />
    </div>
  );
}

// Main Component
export default function GameRouletteUI() {
  const [viewportScale, setViewportScale] = useState(1);
  const [gamesDb] = useState<GameEntry[]>(() => dedupeGames((database.games ?? []).map(toGameEntry)));
  const [spinPool, setSpinPool] = useState<GameEntry[]>([]);
  const [selectedGame, setSelectedGame] = useState<GameEntry | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('Нормально');
  const [isDifficultyOpen, setIsDifficultyOpen] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [hasSpun, setHasSpun] = useState(false);
  const [spinTranslate, setSpinTranslate] = useState(0);
  const [spinTransition, setSpinTransition] = useState('none');
  const [spinSequence, setSpinSequence] = useState<GameEntry[] | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [soundVolume, setSoundVolume] = useState(() => Number(localStorage.getItem(LS_SOUND_VOLUME) ?? 70));

  const [filters, setFilters] = useState({
    ratingMin: Number(localStorage.getItem(LS_RATING_MIN) ?? MIN_RATING),
    ratingMax: Number(localStorage.getItem(LS_RATING_MAX) ?? MAX_RATING),
    periodMin: Number(localStorage.getItem(LS_PERIOD_MIN_INDEX) ?? 0),
    periodMax: Number(localStorage.getItem(LS_PERIOD_MAX_INDEX) ?? PERIOD_BUCKETS.length - 1),
    roundSize: Number(localStorage.getItem(LS_ROUND_SIZE) ?? DEFAULT_ROUND_SIZE),
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const tickTimeoutsRef = useRef<number[]>([]);

  const filteredGamesDb = useMemo(() => {
    return gamesDb.filter(g => {
      const r = g.ratingValue ?? 0;
      const withinRating = r >= filters.ratingMin && r <= filters.ratingMax;
      const sYear = PERIOD_BUCKETS[filters.periodMin].start;
      const eYear = PERIOD_BUCKETS[filters.periodMax].end;
      const gStart = g.yearStart ?? 1900;
      const gEnd = g.yearEnd ?? 2026;
      const withinPeriod = gEnd >= sYear && gStart <= eYear;
      return withinRating && withinPeriod;
    });
  }, [gamesDb, filters]);

  useEffect(() => {
    const up = () => setViewportScale(Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT));
    up(); window.addEventListener('resize', up); return () => window.removeEventListener('resize', up);
  }, []);

  useEffect(() => {
    localStorage.setItem(LS_SOUND_VOLUME, String(soundVolume));
    localStorage.setItem(LS_RATING_MIN, String(filters.ratingMin));
    localStorage.setItem(LS_RATING_MAX, String(filters.ratingMax));
    localStorage.setItem(LS_PERIOD_MIN_INDEX, String(filters.periodMin));
    localStorage.setItem(LS_PERIOD_MAX_INDEX, String(filters.periodMax));
    localStorage.setItem(LS_ROUND_SIZE, String(filters.roundSize));
  }, [soundVolume, filters]);

  const playTone = (freq: number, dur: number, vol: number, type: OscillatorType) => {
    if (soundVolume === 0) return;
    if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(vol * (soundVolume / 100), ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur / 1000);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + dur / 1000 + 0.05);
  };

  const handleSpin = async () => {
    if (isSpinning || filteredGamesDb.length === 0) return;

    // 1. Подготовка раунда
    const count = filters.roundSize;
    const shuffled = [...filteredGamesDb].sort(() => 0.5 - Math.random());
    const newRound = shuffled.slice(0, count);
    
    setIsSpinning(true);
    setHasSpun(true);
    setSpinPool(newRound);
    setSelectedGame(null);
    setSpinTransition('none');
    setSpinTranslate(0);

    // 2. Параллельная загрузка ВСЕХ обложек раунда
    newRound.forEach(game => {
      fetchStopgameCover(game.stopgameUrl).then(url => {
        setSpinPool(prev => prev.map(g => g.id === game.id ? { ...g, assets: { ...g.assets, stopgameCoverUrl: url, stopgameCoverFetched: true } } : g));
      });
    });

    // 3. Логика вращения
    const loops = 5;
    const winnerIdx = Math.floor(Math.random() * newRound.length);
    const totalSteps = newRound.length * loops + winnerIdx;
    const duration = 6000 + totalSteps * 10;
    
    // Построение последовательности для отрисовки
    const seq: GameEntry[] = [];
    for (let i = -WINNER_ROW_INDEX; i <= totalSteps + 4; i++) {
        seq.push(newRound[(i + newRound.length * 100) % newRound.length]);
    }
    setSpinSequence(seq);

    // 4. Звуки тиканья
    tickTimeoutsRef.current.forEach(clearTimeout);
    tickTimeoutsRef.current = [];
    for (let i = 0; i < totalSteps; i++) {
      const progress = i / totalSteps;
      const delay = duration * Math.pow(progress, 3);
      const t = window.setTimeout(() => playTone(1000 - progress * 400, 30, 0.02, 'square'), delay);
      tickTimeoutsRef.current.push(t);
    }

    // 5. Запуск анимации
    requestAnimationFrame(() => {
      setSpinTransition(`transform ${duration}ms cubic-bezier(0.15, 0, 0.15, 1)`);
      setSpinTranslate(-(totalSteps * STEP_DISTANCE + SPIN_OVERSHOOT));
    });

    setTimeout(() => {
      setSpinTransition('transform 600ms ease-out');
      setSpinTranslate(-(totalSteps * STEP_DISTANCE));
      
      setTimeout(() => {
        const winner = newRound[winnerIdx];
        setSelectedGame(winner);
        setIsSpinning(false);
        playTone(523, 150, 0.05, 'triangle'); // Win sound
        setTimeout(() => playTone(659, 200, 0.05, 'triangle'), 150);
      }, 600);
    }, duration);
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#090a0d] text-white select-none" style={{ fontFamily: 'Gilroy, sans-serif' }}>
      <div className="absolute left-1/2 top-1/2" style={{ transform: `translate(-50%, -50%) scale(${viewportScale})` }}>
        <div className="relative flex gap-4 p-4" style={{ width: DESIGN_WIDTH, height: DESIGN_HEIGHT }}>
          
          {/* Левая панель: Инфо об игре */}
          <aside className="w-[360px] flex flex-col rounded-[34px] bg-[#101115] p-6">
            <div className={`relative rounded-[30px] bg-[#17191e] p-4 transition-all duration-500 ${selectedGame ? 'shadow-[0_0_40px_rgba(34,197,94,0.2)] scale-[1.02]' : ''}`}>
              <div className="overflow-hidden rounded-[18px] aspect-square bg-[#202228] flex items-center justify-center">
                {selectedGame?.assets?.stopgameCoverUrl ? (
                  <img src={selectedGame.assets.stopgameCoverUrl} className="w-full h-full object-cover animate-in fade-in duration-500" />
                ) : (
                  <div className="text-zinc-600 font-bold text-center px-4">{selectedGame?.title?.toUpperCase() || 'ОЖИДАНИЕ...'}</div>
                )}
              </div>
              <div className="mt-4 text-center text-[28px] font-bold truncate h-[40px]">
                {selectedGame?.title || '???'}
              </div>
            </div>

            <div className="mt-8 space-y-3">
              <div className="flex gap-2"><Pill>⭐ {selectedGame?.rating?.text || '—'}</Pill><Pill>⏳ {selectedGame?.hoursValue || '—'} ч</Pill></div>
              <div className="relative">
                <button onClick={() => setIsDifficultyOpen(!isDifficultyOpen)} className="w-full flex justify-between items-center bg-white text-black rounded-full h-[48px] px-6 font-bold">
                  <span>Сложность: {difficulty}</span>
                  <span className={isDifficultyOpen ? 'rotate-180' : ''}>▼</span>
                </button>
                {isDifficultyOpen && (
                  <div className="absolute top-full mt-2 w-full bg-white rounded-2xl p-2 z-50 shadow-xl">
                    {DIFFICULTIES.map(d => <button key={d} onClick={() => {setDifficulty(d); setIsDifficultyOpen(false);}} className="w-full p-3 text-black hover:bg-zinc-100 rounded-xl text-left font-medium">{d}</button>)}
                  </div>
                )}
              </div>
              <Pill className="w-full justify-between"><span>Очки:</span> <span className="text-emerald-500">{selectedGame ? (selectedGame.ratingValue! * DIFFICULTY_MULTIPLIER[difficulty]).toFixed(1) : '0'}</span></Pill>
            </div>

            <div className="mt-auto flex gap-2">
              <a href={selectedGame?.stopgameUrl} target="_blank" className="flex-1 h-12 bg-white/10 hover:bg-white text-white hover:text-black rounded-full flex items-center justify-center font-bold transition-colors">SG</a>
              <a href={`https://store.steampowered.com/search/?term=${selectedGame?.title}`} target="_blank" className="flex-1 h-12 bg-white/10 hover:bg-white text-white hover:text-black rounded-full flex items-center justify-center font-bold transition-colors">Steam</a>
            </div>
          </aside>

          {/* Центр: Рулетка */}
          <main className="flex-1 bg-[#ececec] rounded-[34px] relative overflow-hidden p-8">
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                {/* Маркеры центра */}
                <div className="absolute z-20 left-4 right-4 top-1/2 -translate-y-1/2 h-[100px] border-y-2 border-[#ff1e68]/30 pointer-events-none" />
                
                <div className="w-full overflow-hidden" style={{ height: VISIBLE_TRACK_HEIGHT }}>
                  <div style={{ transform: `translateY(${spinTranslate}px)`, transition: spinTransition }} className="flex flex-col gap-[10px]">
                    {(spinSequence || Array(9).fill({title: ''})).map((g, i) => (
                      <div key={i} className={`h-[92px] flex items-center justify-center rounded-full transition-all duration-300 ${i === WINNER_ROW_INDEX ? 'bg-black text-white scale-105 shadow-lg text-[32px]' : 'bg-black/5 text-black/30 text-[24px]'}`}>
                        <span className="truncate px-12 font-bold uppercase">{g.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
            </div>

            <button 
              onClick={handleSpin} 
              disabled={isSpinning || filteredGamesDb.length === 0}
              className="absolute bottom-8 left-1/2 -translate-x-1/2 h-16 px-12 bg-black text-white rounded-full font-black text-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
            >
              {isSpinning ? 'УДАЧИ!' : 'МНЕ ПОВЕЗЕТ!'}
            </button>
          </main>

          {/* Правая панель: Настройки и Путь */}
          <aside className="w-[360px] flex flex-col rounded-[34px] bg-[#101115] p-6">
            <h3 className="text-zinc-500 font-bold mb-4 px-2 uppercase tracking-widest text-sm">Игры в раунде</h3>
            <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
              {spinPool.map(g => (
                <button key={g.id} onClick={() => setSelectedGame(g)} className={`w-full p-4 rounded-2xl text-left transition-all ${selectedGame?.id === g.id ? 'bg-emerald-500 text-white' : 'bg-white/5 text-zinc-400 hover:bg-white/10'}`}>
                  <div className="font-bold truncate">{g.title}</div>
                </button>
              ))}
            </div>
            <button onClick={() => setIsSettingsOpen(true)} className="mt-4 h-14 bg-white text-black rounded-full font-bold flex items-center justify-center gap-2">
              ⚙️ НАСТРОЙКИ
            </button>
          </aside>
        </div>
      </div>

      {/* Модалка настроек */}
      {isSettingsOpen && (
        <div className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-8 animate-in fade-in duration-300">
           <div className="bg-[#17191e] w-full max-w-xl rounded-[40px] p-10 border border-white/10 relative">
              <button onClick={() => setIsSettingsOpen(false)} className="absolute top-6 right-6 text-4xl text-zinc-500 hover:text-white">×</button>
              <h2 className="text-3xl font-black mb-8">ФИЛЬТРЫ</h2>
              
              <div className="space-y-8">
                <section>
                  <label className="block text-zinc-500 font-bold mb-4 uppercase text-sm">Рейтинг: {filters.ratingMin} — {filters.ratingMax}</label>
                  <DualRangeSlider min={0} max={5} step={0.1} minValue={filters.ratingMin} maxValue={filters.ratingMax} 
                    onMinChange={v => setFilters(f => ({...f, ratingMin: v}))} onMaxChange={v => setFilters(f => ({...f, ratingMax: v}))} />
                </section>

                <section>
                  <label className="block text-zinc-500 font-bold mb-4 uppercase text-sm">Период выхода</label>
                  <DualRangeSlider min={0} max={PERIOD_BUCKETS.length - 1} step={1} minValue={filters.periodMin} maxValue={filters.periodMax} 
                    onMinChange={v => setFilters(f => ({...f, periodMin: v}))} onMaxChange={v => setFilters(f => ({...f, periodMax: v}))} />
                  <div className="text-center mt-2 font-bold text-emerald-500">
                    {PERIOD_BUCKETS[filters.periodMin].start} — {PERIOD_BUCKETS[filters.periodMax].end}
                  </div>
                </section>

                <section>
                  <label className="block text-zinc-500 font-bold mb-2 uppercase text-sm">Громкость: {soundVolume}%</label>
                  <input type="range" value={soundVolume} onChange={e => setSoundVolume(Number(e.target.value))} className="w-full accent-emerald-500" />
                </section>

                <div className="pt-4 border-t border-white/5 flex gap-4">
                  <div className="flex-1 bg-white/5 rounded-2xl p-4 text-center">
                    <div className="text-zinc-500 text-xs font-bold uppercase">Подходит игр</div>
                    <div className="text-2xl font-black text-emerald-500">{filteredGamesDb.length}</div>
                  </div>
                  <button onClick={() => setIsSettingsOpen(false)} className="flex-[2] bg-emerald-500 rounded-2xl font-black text-xl hover:bg-emerald-400 transition-colors">СОХРАНИТЬ</button>
                </div>
              </div>
           </div>
        </div>
      )}

      <style>{`
        .range-thumb::-webkit-slider-thumb { appearance: none; width: 24px; height: 24px; cursor: pointer; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
      `}</style>
    </div>
  );
}

function Pill({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`h-[48px] bg-white/5 rounded-full px-6 flex items-center font-bold text-lg ${className}`}>
      {children}
    </div>
  );
}

type RangeSliderProps = {
  min: number; max: number; step: number;
  minValue: number; maxValue: number;
  onMinChange: (v: number) => void; onMaxChange: (v: number) => void;
};
