import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { pool } from './db.js';
import { taxiRoutes } from './routes/taxis.js';
import { orderRoutes } from './routes/orders.js';
import { telemetryRoutes } from './routes/telemetry.js';
import { resetRoutes } from './routes/reset.js';
import { fleetSize, seedWorld } from './services/simulation.js';
import { idleForMs, isWorkerRunning, noteActivity, stopWorker } from './services/worker.js';

const app = Fastify({
  logger: {
    level: 'info',
    transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
  },
});

// Автостоп воркера по простою: любой /api/* запрос продлевает активность и будит
// воркер, если он спал. /api/health намеренно исключён — иначе внешний healthcheck
// или мониторинг будет держать симуляцию вечно живой, сводя автостоп на нет.
app.addHook('onRequest', async (request) => {
  if (request.url.startsWith('/api/') && request.url !== '/api/health') {
    noteActivity();
  }
});

await app.register(cors, { origin: true });
await app.register(taxiRoutes);
await app.register(orderRoutes);
await app.register(telemetryRoutes);
await app.register(resetRoutes);

app.get('/api/health', async () => {
  const { rows } = await pool.query<{ now: string }>('SELECT now() AS now');
  return {
    ok: true,
    db: rows[0].now,
    city: config.city,
    worker: { running: isWorkerRunning(), idleForMs: idleForMs() },
  };
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

  // Воркер НЕ стартует здесь: по требованию — включается только по первому /api/*
  // запросу пользователя (см. noteActivity в onRequest-хуке выше) и засыпает сам
  // через config.workerIdleTimeoutMs простоя (см. tick() в worker.ts).
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
