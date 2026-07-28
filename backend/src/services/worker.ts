import { pool } from '../db.js';
import { config } from '../config.js';
import type { TaxiStatus } from '../types.js';
import {
  type Point,
  distanceM,
  movePoint,
  randomBetween,
  randomPointInCircle,
  stepToward,
} from './geo.js';
import { fetchRoute } from './osrm.js';

/**
 * Фоновый воркер симуляции.
 *
 * Единственный модульный таймер: startWorker() всегда сначала гасит предыдущий,
 * поэтому повторные вызовы (в частности из /api/reset) не плодят параллельные тики.
 *
 * Автостоп по простою: noteActivity() продлевает lastRequestAt при каждом /api/*
 * запросе (см. onRequest-хук в server.ts) и будит воркер, если он спал. Сам тик
 * проверяет простой и останавливает себя — отдельного сторожевого таймера не нужно.
 */
let timer: NodeJS.Timeout | null = null;
let ticking = false;
let lastRequestAt = Date.now();

interface TaxiRow {
  id: number;
  status: TaxiStatus;
  lat: number;
  lon: number;
  has_route: boolean;
  route_progress_m: number;
  route_length_m: number | null;
  order_id: number | null;
  target_lat: number | null;
  target_lon: number | null;
}

/** Машина без активного маршрута продвигается по прямой (фолбэк) — новая точка сразу. */
interface StraightMove {
  kind: 'straight';
  id: number;
  next: Point;
  speedKmh: number;
  arrivedOrderId: number | null;
}

/** Машина с маршрутом продвигается вдоль сохранённой линии — считаем только метры. */
interface RouteMove {
  kind: 'route';
  id: number;
  progressM: number;
  speedKmh: number;
  arrived: boolean;
  orderId: number | null;
}

type Movement = StraightMove | RouteMove;

function planMovement(row: TaxiRow, tickSeconds: number): Movement {
  const from: Point = { lat: row.lat, lon: row.lon };

  if (row.has_route && row.route_length_m !== null) {
    const stepMin =
      row.status === 'ON_THE_WAY' ? config.motion.enrouteStepMin : config.motion.idleStepMin;
    const stepMax =
      row.status === 'ON_THE_WAY' ? config.motion.enrouteStepMax : config.motion.idleStepMax;
    const step = randomBetween(stepMin, stepMax);
    const progressM = Math.min(row.route_progress_m + step, row.route_length_m);
    const arrived = progressM >= row.route_length_m - 0.5;

    return {
      kind: 'route',
      id: row.id,
      progressM,
      speedKmh: (step / tickSeconds) * 3.6,
      arrived,
      orderId: row.order_id,
    };
  }

  // Фолбэк без маршрута: OSRM ещё не ответил или недоступен — блуждание/прямая, как раньше.
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
    const center: Point = { lat: config.city.lat, lon: config.city.lon };
    const step = randomBetween(config.motion.idleStepMin, config.motion.idleStepMax);
    const outOfBounds = distanceM(from, center) > config.city.spawnRadiusM;
    next = outOfBounds
      ? stepToward(from, center, step)
      : movePoint(from, step, Math.random() * 2 * Math.PI);
  }

  const moved = distanceM(from, next);
  return {
    kind: 'straight',
    id: row.id,
    next,
    speedKmh: (moved / tickSeconds) * 3.6,
    arrivedOrderId,
  };
}

/**
 * Просит OSRM маршрут-«патруль» для IDLE-машины без активной линии.
 * Ограничено maxRouteRequestsPerTick вызывающим кодом — иначе при большом парке
 * на старте улетит по запросу на каждую машину одновременно к чужому демо-серверу.
 */
async function requestPatrolRoute(taxi: { id: number; lat: number; lon: number }): Promise<void> {
  const destination = randomPointInCircle(
    { lat: config.city.lat, lon: config.city.lon },
    config.city.spawnRadiusM,
  );
  const route = await fetchRoute({ lat: taxi.lat, lon: taxi.lon }, destination);
  if (!route || route.coordinates.length < 2) return;

  const wkt = `LINESTRING(${route.coordinates.map((p) => `${p.lon} ${p.lat}`).join(', ')})`;
  await pool.query(
    `UPDATE taxis
     SET route = ST_SetSRID(ST_GeomFromText($2), 4326), route_progress_m = 0
     WHERE id = $1 AND status = 'IDLE'`,
    [taxi.id, wkt],
  );
}

async function tick(): Promise<void> {
  if (Date.now() - lastRequestAt > config.workerIdleTimeoutMs) {
    console.log('[worker] idle timeout reached, stopping');
    stopWorker();
    return;
  }

  // Пропускаем тик, если предыдущий ещё не закончился (медленная БД) — иначе
  // накладывающиеся апдейты дадут рваную телеметрию.
  if (ticking) return;
  ticking = true;

  const client = await pool.connect();
  try {
    const { rows } = await client.query<TaxiRow>(
      `SELECT t.id,
              t.status,
              ST_Y(t.current_location) AS lat,
              ST_X(t.current_location) AS lon,
              (t.route IS NOT NULL)    AS has_route,
              t.route_progress_m,
              ST_Length(t.route::geography) AS route_length_m,
              o.id                     AS order_id,
              ST_Y(o.user_location)    AS target_lat,
              ST_X(o.user_location)    AS target_lon
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

    const straight = moves.filter((m): m is StraightMove => m.kind === 'straight');
    const onRoute = moves.filter((m): m is RouteMove => m.kind === 'route');

    await client.query('BEGIN');

    if (straight.length > 0) {
      const ids = straight.map((m) => m.id);
      const lons = straight.map((m) => m.next.lon);
      const lats = straight.map((m) => m.next.lat);

      await client.query(
        `UPDATE taxis t
         SET current_location = ST_SetSRID(ST_MakePoint(m.lon, m.lat), 4326),
             updated_at = now()
         FROM unnest($1::int[], $2::float8[], $3::float8[]) AS m(id, lon, lat)
         WHERE t.id = m.id`,
        [ids, lons, lats],
      );

      await client.query(
        `INSERT INTO taxi_telemetry (time, taxi_id, status, location, speed_kmh)
         SELECT now(), m.id, t.status,
                ST_SetSRID(ST_MakePoint(m.lon, m.lat), 4326), m.speed
         FROM unnest($1::int[], $2::float8[], $3::float8[], $4::float8[]) AS m(id, lon, lat, speed)
         JOIN taxis t ON t.id = m.id`,
        [ids, lons, lats, straight.map((m) => m.speedKmh)],
      );
    }

    if (onRoute.length > 0) {
      const ids = onRoute.map((m) => m.id);
      const progress = onRoute.map((m) => m.progressM);

      // Позиция берётся не расчётом, а самой линией: ST_LineInterpolatePoint работает
      // в долях длины (0..1), поэтому делим пройденные метры на ST_Length(route).
      // Так машина физически не может оказаться вне сохранённого маршрута.
      await client.query(
        `UPDATE taxis t
         SET route_progress_m = m.progress,
             current_location = ST_LineInterpolatePoint(
               t.route,
               LEAST(1.0, m.progress / NULLIF(ST_Length(t.route::geography), 0))
             ),
             updated_at = now()
         FROM unnest($1::int[], $2::float8[]) AS m(id, progress)
         WHERE t.id = m.id`,
        [ids, progress],
      );

      await client.query(
        `INSERT INTO taxi_telemetry (time, taxi_id, status, location, speed_kmh)
         SELECT now(), t.id, t.status, t.current_location, m.speed
         FROM unnest($1::int[], $2::float8[]) AS m(id, speed)
         JOIN taxis t ON t.id = m.id`,
        [ids, onRoute.map((m) => m.speedKmh)],
      );
    }

    // Доехавшие по маршруту.
    const arrivedOnRoute = onRoute.filter((m) => m.arrived && m.orderId !== null);
    const arrivedStraight = straight.filter((m) => m.arrivedOrderId !== null);
    const arrivedOrderIds = [
      ...arrivedOnRoute.map((m) => m.orderId as number),
      ...arrivedStraight.map((m) => m.arrivedOrderId as number),
    ];
    const arrivedTaxiIds = [
      ...arrivedOnRoute.map((m) => m.id),
      ...arrivedStraight.map((m) => m.id),
    ];

    if (arrivedTaxiIds.length > 0) {
      await client.query(`UPDATE orders SET status = 'COMPLETED' WHERE id = ANY($1::int[])`, [
        arrivedOrderIds,
      ]);
      await client.query(
        `UPDATE taxis SET status = 'IDLE', route = NULL, route_progress_m = 0
         WHERE id = ANY($1::int[])`,
        [arrivedTaxiIds],
      );
    }

    // IDLE-машины без маршрута (или только что его закончившие) допущены до нового
    // "патрульного" пути. Не более maxRouteRequestsPerTick за тик — иначе на старте
    // с 10 машинами улетит 10 одновременных запросов к чужому демо-серверу OSRM.
    const needsPatrol = rows
      .filter((r) => r.status === 'IDLE' && !r.has_route)
      .slice(0, config.osrm.maxRouteRequestsPerTick);

    await client.query('COMMIT');

    if (needsPatrol.length > 0) {
      void Promise.allSettled(needsPatrol.map((t) => requestPatrolRoute(t))).catch(() => {});
    }
  } catch (err) {
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

/** Вызывается из onRequest-хука на каждый /api/* запрос. Будит воркер, если он спал. */
export function noteActivity(): void {
  lastRequestAt = Date.now();
  if (timer === null) {
    startWorker();
  }
}

export function idleForMs(): number {
  return Date.now() - lastRequestAt;
}
