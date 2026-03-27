import { useEffect, useMemo, useRef, useState } from 'react'
import { InfoRow } from './components/InfoRow'
import { Pill } from './components/Pill'
import { GAMES_DB, GAMES_DB_TOTAL } from './data/games'
import type { Difficulty, GameEntry } from './types/game'
import { getPeriodText, getRatingText, getStopgameButtonHref } from './utils/format'
import {
  buildSpinSequence,
  buildVisibleGames,
  getRandomGames,
  SPIN_OVERSHOOT,
  SPIN_POOL_SIZE,
  STEP_DISTANCE,
  VISIBLE_TRACK_HEIGHT,
  WINNER_ROW_INDEX,
} from './utils/roulette'

type AudioContextCtor = {
  new (): AudioContext
}

const DIFFICULTIES: Difficulty[] = ['Легкая', 'Нормальная', 'Сложная']

export default function App() {
  const [spinPool, setSpinPool] = useState<GameEntry[]>(() => getRandomGames(GAMES_DB, SPIN_POOL_SIZE))
  const [selectedGame, setSelectedGame] = useState<GameEntry | null>(null)
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null)
  const [isDifficultyOpen, setIsDifficultyOpen] = useState(false)
  const [isSpinning, setIsSpinning] = useState(false)
  const [centerIndex, setCenterIndex] = useState(0)
  const [spinTranslate, setSpinTranslate] = useState(0)
  const [spinTransition, setSpinTransition] = useState('none')
  const [spinSequence, setSpinSequence] = useState<GameEntry[] | null>(null)
  const [presetCount, setPresetCount] = useState<number>(0)
  const [isPresetOpen, setIsPresetOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isSoundEnabled, setIsSoundEnabled] = useState<boolean>(() => {
    const saved = window.localStorage.getItem('soundEnabled')
    return saved !== null ? JSON.parse(saved) : true
  })
  const [soundVolume, setSoundVolume] = useState<number>(() => {
    const saved = window.localStorage.getItem('soundVolume')
    return saved !== null ? Number(saved) : 70
  })

  const spinTimeoutRef = useRef<number | null>(null)
  const settleTimeoutRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const tickTimeoutsRef = useRef<number[]>([])

  const repeatedSpinPool = useMemo(() => {
    const base = spinPool.length > 0 ? spinPool : GAMES_DB.slice(0, SPIN_POOL_SIZE)
    if (base.length === 0) return []
    return Array.from({ length: 80 }, (_, index) => base[index % base.length])
  }, [spinPool])

  useEffect(() => {
    window.localStorage.setItem('soundEnabled', JSON.stringify(isSoundEnabled))
  }, [isSoundEnabled])

  useEffect(() => {
    window.localStorage.setItem('soundVolume', String(soundVolume))
  }, [soundVolume])

  useEffect(() => {
    if (spinPool.length > 0) {
      setSelectedGame(spinPool[0])
      setCenterIndex(0)
    }
  }, [spinPool])

  useEffect(() => {
    return () => {
      if (spinTimeoutRef.current !== null) window.clearTimeout(spinTimeoutRef.current)
      if (settleTimeoutRef.current !== null) window.clearTimeout(settleTimeoutRef.current)
      tickTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
      tickTimeoutsRef.current = []
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        void audioContextRef.current.close()
      }
    }
  }, [])

  const visibleGames = useMemo(() => {
    if (repeatedSpinPool.length === 0) return []
    return buildVisibleGames(repeatedSpinPool, centerIndex)
  }, [centerIndex, repeatedSpinPool])

  const laneGames = spinSequence ?? visibleGames

  const getAudioContext = () => {
    const audioWindow = window as Window & { webkitAudioContext?: AudioContextCtor }
    const AudioContextClass: AudioContextCtor | undefined =
      window.AudioContext ?? audioWindow.webkitAudioContext

    if (!AudioContextClass) return null

    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new AudioContextClass()
    }

    if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current.resume()
    }

    return audioContextRef.current
  }

  const playTone = (
    frequency: number,
    durationMs: number,
    volume: number,
    type: OscillatorType,
  ) => {
    if (!isSoundEnabled || soundVolume === 0) return

    const ctx = getAudioContext()
    if (!ctx) return

    const now = ctx.currentTime
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()

    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, now)

    const finalVolume = volume * (soundVolume / 100)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(finalVolume, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000)

    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start(now)
    oscillator.stop(now + durationMs / 1000 + 0.02)
  }

  const clearTickTimeouts = () => {
    tickTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    tickTimeoutsRef.current = []
  }

  const startTickSound = (totalSteps: number, duration: number) => {
    clearTickTimeouts()

    const easing = (t: number) => Math.pow(t, 4.2)
    const baseTimes: number[] = []

    for (let step = 1; step <= totalSteps; step += 1) {
      const progress = step / totalSteps
      baseTimes.push(duration * easing(progress))
    }

    const adjustedTimes = baseTimes.map((time, index) => {
      if (index === 0) return Math.max(12, time * 0.25)

      const prev = baseTimes[index - 1]
      const gap = time - prev
      const slowFactor = index / totalSteps

      let multiplier = 1.05
      if (slowFactor > 0.85) multiplier = 2.2
      else if (slowFactor > 0.7) multiplier = 1.8
      else if (slowFactor > 0.5) multiplier = 1.4

      return prev + Math.max(14, gap * multiplier)
    })

    adjustedTimes.forEach((time, index) => {
      if (time > duration - 2000) return

      const timeoutId = window.setTimeout(() => {
        const progress = (index + 1) / totalSteps
        const pitch = 1200 - progress * 500
        const volume = progress < 0.4 ? 0.028 : progress < 0.75 ? 0.022 : 0.018
        const noteDuration =
          progress < 0.6 ? 22 : progress < 0.8 ? 40 : progress < 0.9 ? 70 : 120

        playTone(pitch, noteDuration, volume, 'square')
      }, Math.max(0, Math.round(time)))

      tickTimeoutsRef.current.push(timeoutId)
    })
  }

  const playWinSound = () => {
    playTone(523.25, 160, 0.05, 'triangle')
    window.setTimeout(() => playTone(659.25, 180, 0.05, 'triangle'), 120)
    window.setTimeout(() => playTone(783.99, 260, 0.06, 'triangle'), 250)
  }

  const handleSpin = () => {
    if (isSpinning || GAMES_DB.length === 0) return

    if (spinTimeoutRef.current !== null) window.clearTimeout(spinTimeoutRef.current)
    if (settleTimeoutRef.current !== null) window.clearTimeout(settleTimeoutRef.current)
    clearTickTimeouts()

    const newRoundGames = getRandomGames(GAMES_DB, SPIN_POOL_SIZE)
    if (newRoundGames.length === 0) return

    const repeatedPool = Array.from(
      { length: Math.max(80, newRoundGames.length * 8) },
      (_, index) => newRoundGames[index % newRoundGames.length],
    )

    const spinStartIndex = 0
    const extraLoops = 4
    const randomExtra = Math.floor(Math.random() * newRoundGames.length)
    const totalSteps = newRoundGames.length * extraLoops + randomExtra
    const winnerIndex = (spinStartIndex + totalSteps) % repeatedPool.length
    const winner = repeatedPool[winnerIndex]
    const duration = 5600 + totalSteps * 70
    const sequence = buildSpinSequence(repeatedPool, spinStartIndex, totalSteps)

    setSpinPool(newRoundGames)
    setSelectedGame(newRoundGames[0])
    setCenterIndex(spinStartIndex)
    setIsSpinning(true)
    setSpinSequence(sequence)
    setSpinTransition('none')
    setSpinTranslate(0)
    startTickSound(totalSteps, duration)

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSpinTransition(`transform ${duration}ms cubic-bezier(0.16, 0.84, 0.24, 1)`)
        setSpinTranslate(-(totalSteps * STEP_DISTANCE + SPIN_OVERSHOOT))
      })
    })

    spinTimeoutRef.current = window.setTimeout(() => {
      setSpinTransition('transform 900ms cubic-bezier(0.25, 1, 0.5, 1)')
      setSpinTranslate(-(totalSteps * STEP_DISTANCE))

      settleTimeoutRef.current = window.setTimeout(() => {
        setCenterIndex(winnerIndex)
        setSelectedGame(winner)
        setSpinSequence(null)

        requestAnimationFrame(() => {
          setSpinTransition('none')
          setSpinTranslate(0)
        })

        clearTickTimeouts()
        playWinSound()
        setIsSpinning(false)
      }, 900)
    }, duration)
  }

  return (
    <div className="app-shell">
      <div className="app-grid">
        <aside className="panel dark-panel left-panel">
          <div className="winner-card">
            <div className="winner-cover">
              {selectedGame?.assets?.stopgameCoverUrl ? (
                <img
                  src={selectedGame.assets.stopgameCoverUrl}
                  alt={selectedGame.title}
                  className="winner-cover-image"
                />
              ) : (
                <div className="winner-cover-placeholder">
                  <div className="winner-cover-inner">
                    <div className="winner-cover-title">
                      {selectedGame?.title?.toUpperCase() ?? 'WINNER'}
                    </div>
                    <div className="winner-cover-badge">WINNER</div>
                    <div className="winner-cover-caption">Обложка игры</div>
                  </div>
                </div>
              )}
            </div>

            <div className="winner-title">{selectedGame?.title ?? '—'}</div>
            <div className="db-pill">База: {GAMES_DB_TOTAL} игр</div>
          </div>

          <div className="info-stack">
            <InfoRow label="Оценка" value={getRatingText(selectedGame)} />
            <InfoRow label="Период" value={getPeriodText(selectedGame)} />

            <div className="info-row">
              <Pill>Сложность</Pill>
              <div className="dropdown-wrap">
                <button
                  type="button"
                  onClick={() => setIsDifficultyOpen((prev) => !prev)}
                  className="white-button select-button"
                >
                  <span>{difficulty ?? 'Выбрать'}</span>
                </button>

                <div className={`dropdown-menu ${isDifficultyOpen ? 'open' : ''}`}>
                  {DIFFICULTIES.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setDifficulty(item)
                        setIsDifficultyOpen(false)
                      }}
                      className="dropdown-item"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <InfoRow label="Игр в раунде" value={String(spinPool.length)} />
          </div>

          <div className="button-group">
            {[
              { label: 'SG', href: getStopgameButtonHref(selectedGame) },
              { label: 'Steam', href: 'https://store.steampowered.com/' },
              { label: 'HLTB', href: 'https://howlongtobeat.com/' },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="white-button link-button"
              >
                {item.label}
              </a>
            ))}
          </div>
        </aside>

        <main className="panel light-panel center-panel">
          <div className="roulette-stage">
            <div className="roulette-markers">
              <div className="marker marker-left">▶</div>
              <div className="marker marker-right">◀</div>
            </div>

            <div className="roulette-window" style={{ height: `${VISIBLE_TRACK_HEIGHT}px` }}>
              <div
                className="roulette-track"
                style={{
                  transform: `translateY(${spinTranslate}px)`,
                  transition: spinTransition,
                  willChange: 'transform',
                }}
              >
                {laneGames.map((game, index) => {
                  const isWinnerRow = index === WINNER_ROW_INDEX

                  return (
                    <div
                      key={`${game.id}-${index}-${centerIndex}-${spinSequence ? 'spin' : 'idle'}`}
                      className={`roulette-item ${isWinnerRow ? 'winner-row' : ''}`}
                    >
                      <span className="roulette-item-text">{game.title}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={handleSpin}
              disabled={isSpinning || GAMES_DB.length === 0}
              className="spin-button"
            >
              {isSpinning ? 'Крутим...' : 'Мне повезет!'}
            </button>
          </div>
        </main>

        <aside className="panel dark-panel right-panel">
          <div className="right-topbar">
            <button type="button" className="white-button topbar-button wide">Выбрать пресет игры</button>

            <div className="dropdown-wrap compact">
              <button
                type="button"
                onClick={() => setIsPresetOpen((prev) => !prev)}
                className="white-button counter-button"
              >
                {presetCount}
              </button>

              <div className={`dropdown-menu right ${isPresetOpen ? 'open' : ''}`}>
                {[0, 1, 2, 3, 4, 5].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => {
                      setPresetCount(num)
                      setIsPresetOpen(false)
                    }}
                    className="dropdown-item"
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="round-list">
            {spinPool.map((game, index) => (
              <button
                key={`${game.id}-${index}`}
                type="button"
                onClick={() => setSelectedGame(game)}
                className="round-list-item"
              >
                {game.title}
              </button>
            ))}
          </div>

          <div className="settings-footer">
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="white-button topbar-button"
            >
              Настройки
            </button>
          </div>
        </aside>
      </div>

      <div className={`modal-overlay ${isSettingsOpen ? 'open' : ''}`}>
        <div className={`modal-card ${isSettingsOpen ? 'open' : ''}`}>
          <div className="modal-header">
            <div>
              <h2>Настройки</h2>
              <p>Пока здесь только звук. Фильтры по годам и рейтингу добавим позже.</p>
            </div>
            <button type="button" onClick={() => setIsSettingsOpen(false)} className="modal-close">
              ×
            </button>
          </div>

          <div className="settings-stack">
            <div className="settings-block">
              <div className="settings-row">
                <div>
                  <div className="settings-title">Звуки</div>
                  <div className="settings-subtitle">Тики рулетки и звук победы</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isSoundEnabled}
                  onClick={() => setIsSoundEnabled((prev) => !prev)}
                  className={`toggle ${isSoundEnabled ? 'enabled' : ''}`}
                >
                  <span className={`toggle-thumb ${isSoundEnabled ? 'enabled' : ''}`} />
                </button>
              </div>
            </div>

            <div className="settings-block">
              <div className="settings-row volume-row">
                <div>
                  <div className="settings-title">Громкость</div>
                  <div className="settings-subtitle">Общий уровень звука интерфейса</div>
                </div>
                <div className="volume-pill">{soundVolume}%</div>
              </div>

              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={soundVolume}
                onChange={(event) => setSoundVolume(Number(event.target.value))}
                className="slider"
                style={{
                  background: `linear-gradient(to right, #22c55e ${soundVolume}%, #52525b ${soundVolume}%)`,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
