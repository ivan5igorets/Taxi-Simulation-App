-- Taxi Simulation App — схема БД.
-- Применяется автоматически при первом старте контейнера (docker-entrypoint-initdb.d).

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TYPE taxi_status AS ENUM ('IDLE', 'SEARCHING', 'ON_THE_WAY');
CREATE TYPE order_status AS ENUM ('PENDING', 'ASSIGNED', 'COMPLETED');

-- Текущее состояние парка. GiST-индекс обслуживает k-NN оператор <-> в /api/orders.
-- route/route_progress_m — активный путь по дорожной сети (см. db/migrations/001_routes.sql
-- и backend/src/services/osrm.ts): воркер двигает машину вдоль этой линии через
-- ST_LineInterpolatePoint, а не по прямой.
CREATE TABLE taxis (
  id SERIAL PRIMARY KEY,
  driver_name TEXT NOT NULL,
  status taxi_status NOT NULL DEFAULT 'IDLE',
  current_location GEOMETRY(Point, 4326) NOT NULL,
  route GEOMETRY(LineString, 4326),
  route_progress_m DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX taxis_location_gist ON taxis USING GIST (current_location);
CREATE INDEX taxis_status_idx ON taxis (status);

-- route/route_distance_m — маршрут заказа для отрисовки на фронте (снимок на момент
-- назначения; повторяет taxis.route того же такси, но не пропадает, когда таксист
-- достигает конца пути и taxis.route обнуляется).
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  user_location GEOMETRY(Point, 4326) NOT NULL,
  assigned_taxi_id INT REFERENCES taxis(id) ON DELETE SET NULL,
  status order_status NOT NULL DEFAULT 'PENDING',
  distance_m DOUBLE PRECISION,
  route GEOMETRY(LineString, 4326),
  route_distance_m DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orders_user_location_gist ON orders USING GIST (user_location);
CREATE INDEX orders_assigned_taxi_idx ON orders (assigned_taxi_id, status);

-- Поток телеметрии. Сознательно без PK и без FK на taxis: hypertable партиционируется
-- по времени, а внешний ключ сюда заблокировал бы TRUNCATE taxis в /api/reset.
CREATE TABLE taxi_telemetry (
  time TIMESTAMPTZ NOT NULL,
  taxi_id INT NOT NULL,
  status taxi_status NOT NULL,
  location GEOMETRY(Point, 4326) NOT NULL,
  speed_kmh DOUBLE PRECISION NOT NULL
);

SELECT create_hypertable('taxi_telemetry', 'time');

CREATE INDEX taxi_telemetry_taxi_time_idx ON taxi_telemetry (taxi_id, time DESC);
