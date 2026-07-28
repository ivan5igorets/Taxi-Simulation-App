-- Добавляет хранение маршрутов по дорожной сети (OSRM) к уже развёрнутой БД.
-- Идемпотентно — можно применять к живому тому, который уже содержит данные
-- от версии до этой миграции (init.sql для новых установок уже включает эти колонки).

ALTER TABLE taxis ADD COLUMN IF NOT EXISTS route GEOMETRY(LineString, 4326);
ALTER TABLE taxis ADD COLUMN IF NOT EXISTS route_progress_m DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS route GEOMETRY(LineString, 4326);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS route_distance_m DOUBLE PRECISION;
