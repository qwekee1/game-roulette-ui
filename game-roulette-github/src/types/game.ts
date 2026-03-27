export type Difficulty = 'Легкая' | 'Нормальная' | 'Сложная'

export type RawGameEntry = {
  id: number | string
  name: string
  url_stopgame: string
  rating?: number | null
  weight?: number | null
}

export type UploadedGamesDatabase = {
  total_games?: number
  games?: RawGameEntry[]
}

export type GameEntry = {
  id: string
  title: string
  stopgameUrl: string
  stopgameSlug?: string
  rating?: {
    value?: number | null
    text?: string | null
    allObservedValues?: string[]
  }
  period?: {
    label?: string
    startYear?: number
    endYear?: number
  }
  assets?: {
    stopgameCoverUrl?: string | null
    stopgameCoverFetched?: boolean
    notes?: string
  }
}
