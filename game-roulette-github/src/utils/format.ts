import type { GameEntry } from '../types/game'

export function getRatingText(game: GameEntry | null): string {
  if (!game) return '—'
  return game.rating?.text ?? game.rating?.value?.toFixed(1) ?? '—'
}

export function getPeriodText(game: GameEntry | null): string {
  if (!game) return '—'
  return game.period?.label ?? '—'
}

export function getStopgameButtonHref(game: GameEntry | null): string {
  return game?.stopgameUrl ?? 'https://stopgame.ru/'
}
