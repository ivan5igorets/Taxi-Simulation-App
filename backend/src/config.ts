import 'dotenv/config';

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) throw new Error(`Env ${name} is not a number: ${raw}`);
  return parsed;
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://taxi:taxi@localhost:5433/taxi',
  port: num('PORT', 3100),

  city: {
    lat: num('CITY_LAT', 50.4501),
    lon: num('CITY_LON', 30.5234),
    spawnRadiusM: num('SPAWN_RADIUS_M', 3000),
  },

  tickMs: num('TICK_MS', 5000),

  /** Сколько машин создаётся при старте мира. */
  fleet: { min: 3, max: 10 },

  /**
   * Скорости движения, м за тик (тик = 5 с).
   * IDLE  ~14-29 км/ч — машина неспешно кружит в ожидании заказа.
   * ON_THE_WAY ~40-72 км/ч — реалистичный городской трафик.
   */
  motion: {
    idleStepMin: 20,
    idleStepMax: 40,
    enrouteStepMin: 55,
    enrouteStepMax: 100,
    /** Ближе этого расстояния к клиенту заказ считается выполненным. */
    arrivalThresholdM: 50,
  },

  osrm: {
    baseUrl: process.env.OSRM_BASE_URL ?? 'https://router.project-osrm.org',
    timeoutMs: num('OSRM_TIMEOUT_MS', 3000),
    /** Сколько подряд идущих сбоев открывает circuit breaker. */
    failureThreshold: 3,
    /** На сколько мс размыкаем цепь после failureThreshold сбоев подряд. */
    circuitOpenMs: 60_000,
    /** Не больше стольки новых маршрутов OSRM за один тик воркера. */
    maxRouteRequestsPerTick: 2,
  },

  /** Воркер засыпает после стольки мс без единого /api/* запроса. */
  workerIdleTimeoutMs: num('WORKER_IDLE_TIMEOUT_MS', 10 * 60 * 1000),
} as const;
