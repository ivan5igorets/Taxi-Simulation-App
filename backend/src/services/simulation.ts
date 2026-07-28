import { pool } from '../db.js';
import { config } from '../config.js';
import { randomPointInCircle } from './geo.js';
import { snapToRoad } from './osrm.js';

const FIRST_NAMES = [
  'Олександр', 'Дмитро', 'Сергій', 'Андрій', 'Володимир',
  'Микола', 'Іван', 'Тарас', 'Богдан', 'Максим',
  'Роман', 'Юрій', 'Артем', 'Віталій', 'Павло',
];

const LAST_NAMES = [
  'Шевченко', 'Коваленко', 'Бондаренко', 'Ткаченко', 'Кравченко',
  'Мельник', 'Поліщук', 'Іваненко', 'Савченко', 'Гриценко',
  'Марченко', 'Лисенко', 'Руденко', 'Петренко', 'Захарчук',
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDriverName(): string {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

/**
 * Создаёт новый парк из 3–10 машин в радиусе SPAWN_RADIUS_M от центра города.
 * Предполагает, что таблицы уже очищены (см. resetWorld).
 */
export async function seedWorld(): Promise<number> {
  const { min, max } = config.fleet;
  const count = min + Math.floor(Math.random() * (max - min + 1));

  const names: string[] = [];
  const lons: number[] = [];
  const lats: number[] = [];

  const rawPoints = Array.from({ length: count }, () =>
    randomPointInCircle({ lat: config.city.lat, lon: config.city.lon }, config.city.spawnRadiusM),
  );

  // Прижимаем стартовые точки к дорожной сети через OSRM, чтобы машины не спавнились
  // во дворах — недоступность OSRM не должна ронять генерацию мира, поэтому берём
  // allSettled и молча оставляем исходную точку там, где snap не удался.
  const snapped = await Promise.allSettled(rawPoints.map((p) => snapToRoad(p)));

  for (let i = 0; i < count; i++) {
    const result = snapped[i];
    const point = result.status === 'fulfilled' && result.value ? result.value : rawPoints[i];
    names.push(randomDriverName());
    lons.push(point.lon);
    lats.push(point.lat);
  }

  await pool.query(
    `INSERT INTO taxis (driver_name, status, current_location)
     SELECT n, 'IDLE', ST_SetSRID(ST_MakePoint(lon, lat), 4326)
     FROM unnest($1::text[], $2::float8[], $3::float8[]) AS t(n, lon, lat)`,
    [names, lons, lats],
  );

  return count;
}

/** Полная очистка мира и генерация нового парка. Воркер останавливает/запускает вызывающий код. */
export async function resetWorld(): Promise<number> {
  await pool.query('TRUNCATE taxi_telemetry, orders, taxis RESTART IDENTITY CASCADE');
  return seedWorld();
}

/** Есть ли уже машины в БД (чтобы не плодить парк при каждом рестарте dev-сервера). */
export async function fleetSize(): Promise<number> {
  const { rows } = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM taxis');
  return rows[0].count;
}
