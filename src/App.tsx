import { useEffect, useMemo, useRef, useState } from 'react';
import rawDb from './data/games_roulette_database_merged.json';

type RawGameEntry = {
  id: number | string;
  name: string;
  url_stopgame: string;
  rating?: number | null;
  weight?: number | null;
};

type RawDatabase = {
  total_games?: number;
  games?: RawGameEntry[];
};

type GameEntry = {
  id: string;
  title: string;
  stopgameUrl: string;
  ratingText: string;
};

const SPIN_POOL_SIZE = 10;
const VISIBLE_ROWS = 7;
const WINNER_ROW_INDEX = 3;
const ROW_HEIGHT = 76;
const ROW_GAP = 10;
const STEP_DISTANCE = ROW_HEIGHT + ROW_GAP;
const TRACK_HEIGHT = VISIBLE_ROWS * ROW_HEIGHT + (VISIBLE_ROWS - 1) * ROW_GAP;
const OVERSHOOT = 16;

function normalizeDb(input: RawDatabase): GameEntry[] {
  const entries = Array.isArray(input.games) ? input.games : [];
  const map = new Map<string, GameEntry>();

  for (const entry of entries) {
    const stopgameUrl = String(entry.url_stopgame || '').trim();
    const title = String(entry.name || '').trim();
    if (!stopgameUrl || !title) continue;

    const key = stopgameUrl.toLowerCase();
    if (map.has(key)) continue;

    map.set(key, {
      id: String(entry.id),
      title,
      stopgameUrl,
      ratingText: typeof entry.rating === 'number' ? entry.rating.toFixed(1) : '—',
    });
  }

  return Array.from(map.values());
}

function getRandomGames(items: GameEntry[], count: number): GameEntry[] {
  if (count <= 0 || items.length === 0) return [];
  if (items.length <= count) return [...items];

  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

function buildVisibleGames(source: GameEntry[], centerIndex: number): GameEntry[] {
  if (source.length === 0) return [];

  const result: GameEntry[] = [];
  for (let offset = -WINNER_ROW_INDEX; offset < VISIBLE_ROWS - WINNER_ROW_INDEX; offset += 1) {
    const index = (centerIndex + offset + source.length) % source.length;
    result.push(source[index]);
  }
  return result;
}

function buildSpinSequence(source: GameEntry[], centerIndex: number, totalSteps: number): GameEntry[] {
  if (source.length === 0) return [];

  const result: GameEntry[] = [];
  for (
    let offset = -WINNER_ROW_INDEX;
    offset <= totalSteps + (VISIBLE_ROWS - WINNER_ROW_INDEX - 1);
    offset += 1
  ) {
    const index = (centerIndex + offset + source.length) % source.length;
    result.push(source[index]);
  }
  return result;
}

function repeatPool(pool: GameEntry[], minLength = 80): GameEntry[] {
  if (pool.length === 0) return [];
  const length = Math.max(minLength, pool.length * 8);
  return Array.from({ length }, (_, index) => pool[index % pool.length]);
}

const database = rawDb as RawDatabase;
const allGames = normalizeDb(database);

export default function App() {
  const [roundGames, setRoundGames] = useState<GameEntry[]>(() => getRandomGames(allGames, SPIN_POOL_SIZE));
  const [selectedGame, setSelectedGame] = useState<GameEntry | null>(() => null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [centerIndex, setCenterIndex] = useState(0);
  const [spinTranslate, setSpinTranslate] = useState(0);
  const [spinTransition, setSpinTransition] = useState('none');
  const [spinSequence, setSpinSequence] = useState<GameEntry[] | null>(null);

  const spinTimeoutRef = useRef<number | null>(null);
  const settleTimeoutRef = useRef<number | null>(null);

  const repeatedRound = useMemo(() => repeatPool(roundGames), [roundGames]);
  const visibleGames = useMemo(() => buildVisibleGames(repeatedRound, centerIndex), [repeatedRound, centerIndex]);
  const laneGames = spinSequence ?? visibleGames;

  useEffect(() => {
    if (!selectedGame && roundGames.length > 0) {
      setSelectedGame(roundGames[0]);
    }
  }, [roundGames, selectedGame]);

  useEffect(() => {
    return () => {
      if (spinTimeoutRef.current !== null) window.clearTimeout(spinTimeoutRef.current);
      if (settleTimeoutRef.current !== null) window.clearTimeout(settleTimeoutRef.current);
    };
  }, []);

  const handleSpin = () => {
    if (isSpinning || allGames.length === 0) return;

    if (spinTimeoutRef.current !== null) window.clearTimeout(spinTimeoutRef.current);
    if (settleTimeoutRef.current !== null) window.clearTimeout(settleTimeoutRef.current);

    const newRound = getRandomGames(allGames, SPIN_POOL_SIZE);
    if (newRound.length === 0) return;

    const repeatedPool = repeatPool(newRound);
    const spinStartIndex = 0;
    const extraLoops = 4;
    const randomExtra = Math.floor(Math.random() * newRound.length);
    const totalSteps = newRound.length * extraLoops + randomExtra;
    const winnerIndex = (spinStartIndex + totalSteps) % repeatedPool.length;
    const winner = repeatedPool[winnerIndex];
    const duration = 4200 + totalSteps * 55;
    const sequence = buildSpinSequence(repeatedPool, spinStartIndex, totalSteps);

    setRoundGames(newRound);
    setSelectedGame(newRound[0]);
    setCenterIndex(spinStartIndex);
    setSpinSequence(sequence);
    setSpinTransition('none');
    setSpinTranslate(0);
    setIsSpinning(true);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSpinTransition(`transform ${duration}ms cubic-bezier(0.14, 0.84, 0.2, 1)`);
        setSpinTranslate(-(totalSteps * STEP_DISTANCE + OVERSHOOT));
      });
    });

    spinTimeoutRef.current = window.setTimeout(() => {
      setSpinTransition('transform 700ms cubic-bezier(0.25, 1, 0.5, 1)');
      setSpinTranslate(-(totalSteps * STEP_DISTANCE));

      settleTimeoutRef.current = window.setTimeout(() => {
        setCenterIndex(winnerIndex);
        setSelectedGame(winner);
        setSpinSequence(null);
        setSpinTransition('none');
        setSpinTranslate(0);
        setIsSpinning(false);
      }, 700);
    }, duration);
  };

  return (
    <div className="app-shell">
      <div className="page-grid">
        <aside className="panel panel-left">
          <div className="winner-card">
            <div className="cover-placeholder">
              <div className="cover-title">{selectedGame?.title ?? 'WINNER'}</div>
              <div className="cover-subtitle">Winner card</div>
            </div>
            <h1 className="winner-name">{selectedGame?.title ?? '—'}</h1>
            <div className="meta-list">
              <div className="meta-pill"><span>Оценка</span><strong>{selectedGame?.ratingText ?? '—'}</strong></div>
              <div className="meta-pill"><span>Игр в базе</span><strong>{allGames.length}</strong></div>
              <div className="meta-pill"><span>В раунде</span><strong>{roundGames.length}</strong></div>
            </div>
            <div className="action-row">
              <a className="action-button" href={selectedGame?.stopgameUrl ?? 'https://stopgame.ru/'} target="_blank" rel="noreferrer">SG</a>
              <a className="action-button" href="https://store.steampowered.com/" target="_blank" rel="noreferrer">Steam</a>
              <a className="action-button" href="https://howlongtobeat.com/" target="_blank" rel="noreferrer">HLTB</a>
            </div>
          </div>
        </aside>

        <main className="panel panel-center">
          <div className="roulette-frame">
            <div className="roulette-markers">
              <span>▶</span>
              <span>◀</span>
            </div>
            <div className="roulette-track-window" style={{ height: `${TRACK_HEIGHT}px` }}>
              <div className="roulette-track" style={{ transform: `translateY(${spinTranslate}px)`, transition: spinTransition }}>
                {laneGames.map((game, index) => {
                  const isWinnerRow = index === WINNER_ROW_INDEX;
                  return (
                    <div className={`roulette-row ${isWinnerRow ? 'roulette-row--active' : ''}`} key={`${game.id}-${index}-${spinSequence ? 'spin' : 'idle'}`}>
                      {game.title}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <button className="spin-button" type="button" onClick={handleSpin} disabled={isSpinning}>
            {isSpinning ? 'Крутим...' : 'Мне повезет!'}
          </button>
        </main>

        <aside className="panel panel-right">
          <div className="right-title">Игры текущего раунда</div>
          <div className="round-list">
            {roundGames.map((game, index) => (
              <button className="round-item" type="button" key={`${game.id}-${index}`} onClick={() => setSelectedGame(game)}>
                <span className="round-index">{index + 1}.</span>
                <span className="round-title">{game.title}</span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
