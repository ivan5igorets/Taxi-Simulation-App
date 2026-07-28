/** Центр симуляции — Киев. Должен совпадать с CITY_LAT/CITY_LON бекенда. */
export const CITY = {
  lat: 50.4501,
  lon: 30.5234,
  spawnRadiusM: 3000,
  zoom: 13,
} as const;

/** Интервал опроса позиций такси (воркер тикает раз в 5 с). */
export const TAXI_POLL_MS = 2000;

/** Интервал опроса метрик при активном заказе. */
export const STATS_POLL_MS = 5000;

/** Диапазон «поиска водителя» по ТЗ, секунды. */
export const SEARCH_DELAY = { min: 5, max: 10 } as const;
