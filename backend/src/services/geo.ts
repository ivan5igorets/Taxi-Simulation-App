/** Плоская аппроксимация координат — на масштабе города (единицы км) погрешность пренебрежима. */

const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;

export interface Point {
  lat: number;
  lon: number;
}

/** Метров в одном градусе долготы на данной широте. */
function metersPerDegLon(lat: number): number {
  return (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(lat * DEG);
}

/** Метров в одном градусе широты. */
function metersPerDegLat(): number {
  return (Math.PI / 180) * EARTH_RADIUS_M;
}

export function distanceM(a: Point, b: Point): number {
  const midLat = (a.lat + b.lat) / 2;
  const dx = (b.lon - a.lon) * metersPerDegLon(midLat);
  const dy = (b.lat - a.lat) * metersPerDegLat();
  return Math.hypot(dx, dy);
}

/** Сдвиг точки на `meters` в направлении `bearingRad` (0 = на восток, против часовой). */
export function movePoint(from: Point, meters: number, bearingRad: number): Point {
  const dx = Math.cos(bearingRad) * meters;
  const dy = Math.sin(bearingRad) * meters;
  return {
    lat: from.lat + dy / metersPerDegLat(),
    lon: from.lon + dx / metersPerDegLon(from.lat),
  };
}

/** Шаг из `from` в сторону `to`; если цель ближе шага — возвращает саму цель. */
export function stepToward(from: Point, to: Point, meters: number): Point {
  const remaining = distanceM(from, to);
  if (remaining <= meters) return to;
  const midLat = (from.lat + to.lat) / 2;
  const dx = (to.lon - from.lon) * metersPerDegLon(midLat);
  const dy = (to.lat - from.lat) * metersPerDegLat();
  return movePoint(from, meters, Math.atan2(dy, dx));
}

/** Равномерная точка в круге: sqrt(random) убирает сгущение к центру. */
export function randomPointInCircle(center: Point, radiusM: number): Point {
  const r = radiusM * Math.sqrt(Math.random());
  const theta = Math.random() * 2 * Math.PI;
  return movePoint(center, r, theta);
}

export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
