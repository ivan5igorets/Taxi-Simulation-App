import { config } from '../config.js';
import type { Point } from './geo.js';

export interface RoutePath {
  /** Точки маршрута в порядке движения. */
  coordinates: Point[];
  distanceM: number;
  durationS: number;
}

/**
 * Тонкий клиент публичного демо-сервера OSRM (router.project-osrm.org).
 *
 * Это чужая инфраструктура без SLA — таймаут 3с и circuit breaker обязательны,
 * иначе зависший OSRM подвесит тик воркера или запрос /api/orders. Любая ошибка
 * или таймаут возвращает null, а не бросает исключение: вызывающий код обязан
 * иметь фолбэк на движение по прямой (см. worker.ts).
 */

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function circuitIsOpen(): boolean {
  return Date.now() < circuitOpenUntil;
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

function recordFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= config.osrm.failureThreshold) {
    circuitOpenUntil = Date.now() + config.osrm.circuitOpenMs;
    console.warn(
      `[osrm] circuit opened for ${config.osrm.circuitOpenMs}ms after ${consecutiveFailures} failures`,
    );
  }
}

async function osrmFetch<T>(path: string): Promise<T | null> {
  if (circuitIsOpen()) return null;

  try {
    const res = await fetch(`${config.osrm.baseUrl}${path}`, {
      signal: AbortSignal.timeout(config.osrm.timeoutMs),
    });
    if (!res.ok) {
      recordFailure();
      return null;
    }
    const body = (await res.json()) as { code: string } & T;
    if (body.code !== 'Ok') {
      recordFailure();
      return null;
    }
    recordSuccess();
    return body;
  } catch (err) {
    recordFailure();
    console.warn('[osrm] request failed', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Реальный маршрут по дорожной сети между двумя точками. null, если OSRM недоступен. */
export async function fetchRoute(from: Point, to: Point): Promise<RoutePath | null> {
  const path =
    `/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}` +
    `?overview=full&geometries=geojson`;

  const body = await osrmFetch<{
    routes: Array<{
      distance: number;
      duration: number;
      geometry: { coordinates: [number, number][] };
    }>;
  }>(path);

  const route = body?.routes[0];
  if (!route) return null;

  return {
    coordinates: route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
    distanceM: route.distance,
    durationS: route.duration,
  };
}

/** Ближайшая точка на дорожной сети к произвольной координате. null, если OSRM недоступен. */
export async function snapToRoad(point: Point): Promise<Point | null> {
  const path = `/nearest/v1/driving/${point.lon},${point.lat}`;

  const body = await osrmFetch<{
    waypoints: Array<{ location: [number, number] }>;
  }>(path);

  const waypoint = body?.waypoints[0];
  if (!waypoint) return null;

  const [lon, lat] = waypoint.location;
  return { lat, lon };
}

/**
 * Health-probe для /api/health — не влияет на circuit breaker.
 * Координаты 0,0 (океан) не годятся: OSRM не находит рядом дорог и отвечает кодом
 * ошибки, а не сетевым сбоем, — берём точку в центре симулируемого города.
 */
export async function isAvailable(): Promise<boolean> {
  try {
    const res = await fetch(
      `${config.osrm.baseUrl}/nearest/v1/driving/${config.city.lon},${config.city.lat}`,
      { signal: AbortSignal.timeout(config.osrm.timeoutMs) },
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { code: string };
    return body.code === 'Ok';
  } catch {
    return false;
  }
}
