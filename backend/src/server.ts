import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { pool } from './db.js';
import { taxiRoutes } from './routes/taxis.js';
import { orderRoutes } from './routes/orders.js';
import { telemetryRoutes } from './routes/telemetry.js';
import { resetRoutes } from './routes/reset.js';
import { fleetSize, seedWorld } from './services/simulation.js';
import { startWorker, stopWorker } from './services/worker.js';

const app = Fastify({
  logger: {
    level: 'info',
    transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
  },
});

await app.register(cors, { origin: true });
await app.register(taxiRoutes);
await app.register(orderRoutes);
await app.register(telemetryRoutes);
await app.register(resetRoutes);

app.get('/api/health', async () => {
  const { rows } = await pool.query<{ now: string }>('SELECT now() AS now');
  return { ok: true, db: rows[0].now, city: config.city };
});

async function bootstrap(): Promise<void> {
  // Мир создаётся только если БД пустая — рестарт dev-сервера не сбрасывает симуляцию.
  const existing = await fleetSize();
  if (existing === 0) {
    const created = await seedWorld();
    app.log.info({ taxis: created }, 'seeded initial world');
  } else {
    app.log.info({ taxis: existing }, 'reusing existing world');
  }

  startWorker();
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.log.info(`${signal} received, shutting down`);
    stopWorker();
    void app
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}

try {
  await bootstrap();
} catch (err) {
  app.log.error(err, 'failed to start');
  stopWorker();
  await pool.end().catch(() => {});
  process.exit(1);
}
