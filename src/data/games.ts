import rawDatabase from './games_roulette_database_merged.json'
import type { GameEntry, RawGameEntry, UploadedGamesDatabase } from '../types/game'

const database = rawDatabase as UploadedGamesDatabase

export function toGameEntry(raw: RawGameEntry): GameEntry {
  return {
    id: String(raw.id),
    title: raw.name,
    stopgameUrl: raw.url_stopgame,
    stopgameSlug: raw.url_stopgame.split('/').filter(Boolean).pop(),
    rating: {
      value: raw.rating ?? null,
      text: typeof raw.rating === 'number' ? raw.rating.toFixed(1) : null,
      allObservedValues: typeof raw.rating === 'number' ? [raw.rating.toFixed(1)] : [],
    },
    assets: {
      stopgameCoverUrl: null,
      stopgameCoverFetched: false,
    },
  }
}

export function dedupeGames(items: GameEntry[]): GameEntry[] {
  const seen = new Map<string, GameEntry>()

  for (const game of items) {
    const key = (game.stopgameUrl || game.id || game.title).trim().toLowerCase()
    if (!seen.has(key)) {
      seen.set(key, game)
    }
  }

  return Array.from(seen.values())
}

export const RAW_GAMES: RawGameEntry[] = Array.isArray(database.games) ? database.games : []
export const GAMES_DB: GameEntry[] = dedupeGames(RAW_GAMES.map(toGameEntry))
export const GAMES_DB_TOTAL = database.total_games ?? RAW_GAMES.length
