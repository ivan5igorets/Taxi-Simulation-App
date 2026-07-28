import pg from 'pg';
import { config } from './config.js';

// PostGIS возвращает DOUBLE PRECISION (OID 701) и NUMERIC как строки — приводим к числам,
// чтобы координаты и скорости не утекали в JSON строками.
pg.types.setTypeParser(pg.types.builtins.FLOAT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

pool.on('error', (err) => {
  console.error('[db] unexpected idle client error', err);
});
