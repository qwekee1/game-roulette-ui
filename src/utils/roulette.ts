import type { GameEntry } from '../types/game'

export const LANE_ITEM_HEIGHT = 92
export const STEP_GAP = 10
export const STEP_DISTANCE = LANE_ITEM_HEIGHT + STEP_GAP
export const VISIBLE_ROWS = 7
export const WINNER_ROW_INDEX = 3
export const SPIN_OVERSHOOT = 22
export const VISIBLE_TRACK_HEIGHT =
  VISIBLE_ROWS * LANE_ITEM_HEIGHT + (VISIBLE_ROWS - 1) * STEP_GAP
export const SPIN_POOL_SIZE = 10

export function getRandomGames(items: GameEntry[], count: number): GameEntry[] {
  if (items.length === 0 || count <= 0) return []

  if (items.length <= count) {
    return [...items]
  }

  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }

  return copy.slice(0, count)
}

export function buildVisibleGames(source: GameEntry[], centerIndex: number): GameEntry[] {
  const items: GameEntry[] = []
  const total = source.length

  if (total === 0) return items

  for (let offset = -WINNER_ROW_INDEX; offset < VISIBLE_ROWS - WINNER_ROW_INDEX; offset += 1) {
    const index = (centerIndex + offset + total) % total
    items.push(source[index])
  }

  return items
}

export function buildSpinSequence(
  source: GameEntry[],
  centerIndex: number,
  totalSteps: number,
): GameEntry[] {
  const sequence: GameEntry[] = []

  if (source.length === 0) return sequence

  for (
    let offset = -WINNER_ROW_INDEX;
    offset <= totalSteps + (VISIBLE_ROWS - WINNER_ROW_INDEX - 1);
    offset += 1
  ) {
    const index = (centerIndex + offset + source.length) % source.length
    sequence.push(source[index])
  }

  return sequence
}
