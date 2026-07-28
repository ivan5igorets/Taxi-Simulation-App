import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import type { TelemetryBucket, TelemetryStats } from '../types.js';

export async function telemetryRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Агрегация телеметрии средствами TimescaleDB.
   *
   * time_bucket('1 minute', time) — фирменная функция Timescale: раскладывает поток
   * точек по минутным корзинам, запрос идёт только по чанкам за последние 10 минут.
   */
  app.get<{ Params: { taxiId: string } }>(
    '/api/telemetry/stats/:taxiId',
    async (request, reply) => {
      const taxiId = Number(request.params.taxiId);
      if (!Number.isInteger(taxiId)) {
        return reply.status(400).send({ error: 'INVALID_TAXI_ID' });
      }

      const bucketsQuery = pool.query<TelemetryBucket>(
        `SELECT time_bucket('1 minute', time) AS bucket,
                avg(speed_kmh) AS avg_speed_kmh,
                count(*)::int  AS points
         FROM taxi_telemetry
         WHERE taxi_id = $1
           AND time > now() - interval '10 minutes'
         GROUP BY bucket
         ORDER BY bucket`,
        [taxiId],
      );

      // Скалярная сводка за то же окно — крупные цифры в панели метрик.
      const summaryQuery = pool.query<{
        avg_speed_kmh: number | null;
        max_speed_kmh: number | null;
        total_points: number;
      }>(
        `SELECT avg(speed_kmh) AS avg_speed_kmh,
                max(speed_kmh) AS max_speed_kmh,
                count(*)::int  AS total_points
         FROM taxi_telemetry
         WHERE taxi_id = $1
           AND time > now() - interval '10 minutes'`,
        [taxiId],
      );

      const [buckets, summary] = await Promise.all([bucketsQuery, summaryQuery]);
      const s = summary.rows[0];

      const stats: TelemetryStats = {
        taxiId,
        avgSpeedKmh: s.avg_speed_kmh,
        maxSpeedKmh: s.max_speed_kmh,
        totalPoints: s.total_points,
        buckets: buckets.rows,
      };
      return stats;
    },
  );

  // Сводка по всему парку — показывает объём hypertable в демо.
  app.get('/api/telemetry/summary', async () => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS total_points,
              count(DISTINCT taxi_id)::int AS taxis,
              min(time) AS first_point,
              max(time) AS last_point
       FROM taxi_telemetry`,
    );
    return rows[0];
  });
}
