# Game Roulette

Готовый Vite + React + TypeScript проект для GitHub и деплоя на Vercel.

## Что делает

- При загрузке страницы выбирает случайные 10 игр из базы StopGame.
- Показывает эти 10 игр в правой колонке.
- По кнопке **«Мне повезет!»** генерирует новый набор из 10 игр.
- Из этих 10 игр рулетка анимированно выбирает 1 победителя.
- Кнопка **SG** открывает страницу победившей игры на StopGame.
- Настройки звука и громкости сохраняются в `localStorage`.

## Запуск локально

```bash
npm install
npm run dev
```

## Сборка

```bash
npm run build
```

## Деплой на Vercel

1. Залей этот проект в новый GitHub репозиторий.
2. Импортируй репозиторий в Vercel.
3. Framework preset: **Vite**.
4. Build command: `npm run build`
5. Output directory: `dist`

## База игр

Файл базы уже подключён здесь:

`src/data/games_roulette_database_merged.json`

В базе сейчас 18 975 игр по исходному JSON.
