import { pool } from '../db.js';
import { config } from '../config.js';
import type { TaxiStatus } from '../types.js';
import {
  type Point,
  distanceM,
  movePoint,
  randomBetween,
  stepToward,
} from './geo.js';

/**
 * Фоновый воркер симуляции.
 *
 * Единственный модульный таймер: startWorker() всегда сначала гасит предыдущий,
 * поэтому повторные вызовы (в частности из /api/reset) не плодят параллельные тики.
 */
let timer: NodeJS.Timeout | null = null;
let ticking = false;

interface TaxiRow {
  id: number;
  status: TaxiStatus;
  lat: number;
  lon: number;
  target_lat: number | null;
  target_lon: number | null;
  order_id: number | null;
}

interface Movement {
  id: number;
  next: Point;
  speedKmh: number;
  arrivedOrderId: number | null;
}

function planMovement(row: TaxiRow, tickSeconds: number): Movement {
  const from: Point = { lat: row.lat, lon: row.lon };

  // ON_THE_WAY без цели (например, заказ удалён) деградирует до блуждания.
  const hasTarget =
    row.status === 'ON_THE_WAY' && row.target_lat !== null && row.target_lon !== null;

  let next: Point;
  let arrivedOrderId: number | null = null;

  if (hasTarget) {
    const target: Point = { lat: row.target_lat!, lon: row.target_lon! };
    const step = randomBetween(config.motion.enrouteStepMin, config.motion.enrouteStepMax);
    next = stepToward(from, target, step);
    if (distanceM(next, target) <= config.motion.arrivalThresholdM) {
      next = target;
      arrivedOrderId = row.order_id;
    }
  } else {
    // Блуждание: случайное направление, небольшой шаг. Если машина ушла за границу
    // города — разворачиваем её к центру, чтобы парк не расползался по карте.
    const center: Point = { lat: config.city.lat, lon: config.city.lon };
    const step = randomBetween(config.motion.idleStepMin, config.motion.idleStepMax);
    const outOfBounds = distanceM(from, center) > config.city.spawnRadiusM;
    next = outOfBounds
      ? stepToward(from, center, step)
      : movePoint(from, step, Math.random() * 2 * Math.PI);
  }

  const moved = distanceM(from, next);
  return {
    id: row.id,
    next,
    speedKmh: (moved / tickSeconds) * 3.6,
    arrivedOrderId,
  };
}

async function tick(): Promise<void> {
  // Пропускаем тик, если предыдущий ещё не закончился (медленная БД) — иначе
  // накладывающиеся апдейты дадут рваную телеметрию.
  if (ticking) return;
  ticking = true;

  const client = await pool.connect();
  try {
    // Текущее состояние парка + точка назначения для машин в пути.
    const { rows } = await client.query<TaxiRow>(
      `SELECT t.id,
              t.status,
              ST_Y(t.current_location) AS lat,
              ST_X(t.current_location) AS lon,
              ST_Y(o.user_location)    AS target_lat,
              ST_X(o.user_location)    AS target_lon,
              o.id                     AS order_id
       FROM taxis t
       LEFT JOIN LATERAL (
         SELECT id, user_location
         FROM orders
         WHERE assigned_taxi_id = t.id AND status = 'ASSIGNED'
         ORDER BY created_at DESC
         LIMIT 1
       ) o ON t.status = 'ON_THE_WAY'`,
    );

    if (rows.length === 0) return;

    const tickSeconds = config.tickMs / 1000;
    const moves = rows.map((r) => planMovement(r, tickSeconds));

    const ids = moves.map((m) => m.id);
    const lons = moves.map((m) => m.next.lon);
    const lats = moves.map((m) => m.next.lat);
    const speeds = moves.map((m) => m.speedKmh);

    await client.query('BEGIN');

    // Одно обновление на весь парк вместо N запросов.
    await client.query(
      `UPDATE taxis t
       SET current_location = ST_SetSRID(ST_MakePoint(m.lon, m.lat), 4326),
           updated_at = now()
       FROM unnest($1::int[], $2::float8[], $3::float8[]) AS m(id, lon, lat)
       WHERE t.id = m.id`,
      [ids, lons, lats],
    );

    // Телеметрия пишется со статусом ДО возможного перехода в IDLE — точка в пути
    // остаётся помеченной как ON_THE_WAY, что и нужно для метрик заказа.
    await client.query(
      `INSERT INTO taxi_telemetry (time, taxi_id, status, location, speed_kmh)
       SELECT now(), m.id, t.status,
              ST_SetSRID(ST_MakePoint(m.lon, m.lat), 4326), m.speed
       FROM unnest($1::int[], $2::float8[], $3::float8[], $4::float8[]) AS m(id, lon, lat, speed)
       JOIN taxis t ON t.id = m.id`,
      [ids, lons, lats, speeds],
    );

    // Завершение доехавших заказов.
    const arrived = moves.filter((m) => m.arrivedOrderId !== null);
    if (arrived.length > 0) {
      const orderIds = arrived.map((m) => m.arrivedOrderId as number);
      const taxiIds = arrived.map((m) => m.id);
      await client.query(
        `UPDATE orders SET status = 'COMPLETED' WHERE id = ANY($1::int[])`,
        [orderIds],
      );
      await client.query(
        `UPDATE taxis SET status = 'IDLE' WHERE id = ANY($1::int[])`,
        [taxiIds],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    // Один упавший тик не должен убивать интервал — логируем и живём дальше.
    try {
      await client.query('ROLLBACK');
    } catch {
      /* соединение уже мертво — игнорируем */
    }
    console.error('[worker] tick failed', err);
  } finally {
    client.release();
    ticking = false;
  }
}

export function startWorker(): void {
  stopWorker();
  timer = setInterval(() => {
    void tick();
  }, config.tickMs);
  console.log(`[worker] started, tick=${config.tickMs}ms`);
}

export function stopWorker(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
    console.log('[worker] stopped');
  }
}

export function isWorkerRunning(): boolean {
  return timer !== null;
}
