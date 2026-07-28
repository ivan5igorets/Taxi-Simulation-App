import type { FastifyInstance } from 'fastify';
import { resetWorld } from '../services/simulation.js';
import { startWorker, stopWorker } from '../services/worker.js';

export async function resetRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Полный сброс мира.
   *
   * Порядок важен: сначала гасим воркер, иначе тик может записать телеметрию
   * для машин, которых уже нет, между TRUNCATE и seedWorld.
   */
  app.post('/api/reset', async () => {
    stopWorker();
    const taxis = await resetWorld();
    startWorker();
    app.log.info({ taxis }, 'world reset');
    return { ok: true, taxis };
  });
}
