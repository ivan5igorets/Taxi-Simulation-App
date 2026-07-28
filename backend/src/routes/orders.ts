import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';

interface CreateOrderBody {
  lat: number;
  lon: number;
}

const createOrderSchema = {
  body: {
    type: 'object',
    required: ['lat', 'lon'],
    properties: {
      lat: { type: 'number', minimum: -90, maximum: 90 },
      lon: { type: 'number', minimum: -180, maximum: 180 },
    },
  },
} as const;

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Назначение ближайшего свободного такси.
   *
   * PostGIS здесь работает в два приёма:
   *   1. оператор <-> (k-NN) идёт по GiST-индексу и достаёт кандидата, не считая
   *      расстояние до всего парка;
   *   2. ST_Distance по ::geography даёт настоящую дистанцию в метрах.
   */
  app.post<{ Body: CreateOrderBody }>(
    '/api/orders',
    { schema: createOrderSchema },
    async (request, reply) => {
      const { lat, lon } = request.body;
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Кандидаты по k-NN (<- идёт по GiST-индексу), затем отдельный шаг блокировки.
        // Блокировать прямо в k-NN-запросе нельзя: воркер параллельно обновляет те же
        // строки, и index scan натыкается на "attempted to lock invisible tuple".
        // Берём несколько кандидатов, чтобы при занятой первой машине был запасной вариант.
        const candidates = await client.query<{ id: number }>(
          `SELECT id
           FROM taxis
           WHERE status = 'IDLE'
           ORDER BY current_location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
           LIMIT 5`,
          [lon, lat],
        );

        if (candidates.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(409).send({
            error: 'NO_TAXI_AVAILABLE',
            message: 'Нет свободных машин, попробуйте позже',
          });
        }

        // Повторная проверка статуса под блокировкой: между двумя запросами машину
        // мог занять параллельный заказ.
        const locked = await client.query<{ id: number }>(
          `SELECT id
           FROM taxis
           WHERE id = ANY($1::int[]) AND status = 'IDLE'
           ORDER BY array_position($1::int[], id)
           LIMIT 1
           FOR UPDATE SKIP LOCKED`,
          [candidates.rows.map((r) => r.id)],
        );

        if (locked.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(409).send({
            error: 'NO_TAXI_AVAILABLE',
            message: 'Нет свободных машин, попробуйте позже',
          });
        }

        const taxiId = locked.rows[0].id;

        const assigned = await client.query<{
          id: number;
          driver_name: string;
          lat: number;
          lon: number;
          distance_m: number;
        }>(
          `UPDATE taxis
           SET status = 'ON_THE_WAY', updated_at = now()
           WHERE id = $1
           RETURNING id,
                     driver_name,
                     ST_Y(current_location) AS lat,
                     ST_X(current_location) AS lon,
                     ST_Distance(
                       current_location::geography,
                       ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
                     ) AS distance_m`,
          [taxiId, lon, lat],
        );

        const taxi = assigned.rows[0];

        const order = await client.query<{ id: number; created_at: string }>(
          `INSERT INTO orders (user_location, assigned_taxi_id, status, distance_m)
           VALUES (ST_SetSRID(ST_MakePoint($1, $2), 4326), $3, 'ASSIGNED', $4)
           RETURNING id, created_at`,
          [lon, lat, taxiId, taxi.distance_m],
        );

        await client.query('COMMIT');

        return {
          orderId: order.rows[0].id,
          createdAt: order.rows[0].created_at,
          distance_m: taxi.distance_m,
          taxi: {
            id: taxi.id,
            driver_name: taxi.driver_name,
            lat: taxi.lat,
            lon: taxi.lon,
          },
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // Состояние заказа — фронтенд следит за дистанцией до подачи.
  app.get<{ Params: { id: string } }>('/api/orders/:id', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) {
      return reply.status(400).send({ error: 'INVALID_ID' });
    }

    const { rows } = await pool.query(
      `SELECT o.id,
              o.status,
              o.assigned_taxi_id,
              o.distance_m AS initial_distance_m,
              ST_Y(o.user_location) AS user_lat,
              ST_X(o.user_location) AS user_lon,
              ST_Distance(
                t.current_location::geography,
                o.user_location::geography
              ) AS current_distance_m
       FROM orders o
       LEFT JOIN taxis t ON t.id = o.assigned_taxi_id
       WHERE o.id = $1`,
      [id],
    );

    if (rows.length === 0) return reply.status(404).send({ error: 'ORDER_NOT_FOUND' });
    return rows[0];
  });
}
