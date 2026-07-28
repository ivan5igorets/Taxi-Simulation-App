import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import type { Taxi } from '../types.js';

export async function taxiRoutes(app: FastifyInstance): Promise<void> {
  // Текущее положение всего парка — фронтенд опрашивает раз в 2 с.
  app.get('/api/taxis', async () => {
    const { rows } = await pool.query<Taxi>(
      `SELECT id,
              driver_name,
              status,
              ST_Y(current_location) AS lat,
              ST_X(current_location) AS lon
       FROM taxis
       ORDER BY id`,
    );
    return rows;
  });
}
