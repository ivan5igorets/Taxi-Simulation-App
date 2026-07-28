<script setup lang="ts">
import { computed, ref } from 'vue';
import type { OrderResponse, TelemetryStats } from '../api/client';

const props = defineProps<{
  stats: TelemetryStats | null;
  order: OrderResponse | null;
  distanceM: number | null;
  taxiCount: number;
}>();

const open = ref(true);
const showSql = ref(false);

const distanceLabel = computed(() => {
  if (props.distanceM === null) return '—';
  return props.distanceM >= 1000
    ? `${(props.distanceM / 1000).toFixed(2)} км`
    : `${Math.round(props.distanceM)} м`;
});

const avgSpeedLabel = computed(() =>
  props.stats?.avgSpeedKmh != null ? `${props.stats.avgSpeedKmh.toFixed(1)} км/ч` : '—',
);

/**
 * Шкала графика — от нуля до максимума с запасом 15%.
 * Масштабирование ровно по максимуму делает все столбики почти одинаковыми,
 * когда скорости лежат в узком диапазоне (20-30 км/ч).
 */
const maxBucketSpeed = computed(() => {
  const buckets = props.stats?.buckets ?? [];
  const peak = buckets.reduce((max, b) => Math.max(max, b.avg_speed_kmh), 0);
  return peak > 0 ? peak * 1.15 : 1;
});

function bucketTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

const DISTANCE_SQL = `ST_Distance(
  taxi.current_location::geography,
  user_location::geography
) AS distance_m`;

const KNN_SQL = `SELECT id FROM taxis
WHERE status = 'IDLE'
ORDER BY current_location <-> ST_SetSRID(
  ST_MakePoint($lon, $lat), 4326)
LIMIT 5;  -- k-NN по GiST-индексу`;

const BUCKET_SQL = `SELECT time_bucket('1 minute', time) AS bucket,
       avg(speed_kmh) AS avg_speed_kmh,
       count(*) AS points
FROM taxi_telemetry
WHERE taxi_id = $1
  AND time > now() - interval '10 minutes'
GROUP BY bucket ORDER BY bucket;`;
</script>

<template>
  <div class="bg-slate-900/95 border-t border-slate-700 text-slate-100 backdrop-blur">
    <button
      class="w-full flex items-center justify-between px-4 py-2 text-sm font-medium
             hover:bg-slate-800/60 transition-colors"
      @click="open = !open"
    >
      <span class="flex items-center gap-2">
        <span class="text-emerald-400">PostGIS</span>
        <span class="text-slate-500">&amp;</span>
        <span class="text-sky-400">TimescaleDB</span>
        <span class="text-slate-400">— Logs &amp; Metrics</span>
      </span>
      <span class="text-slate-400 text-xs">{{ open ? '▼ свернуть' : '▲ развернуть' }}</span>
    </button>

    <div v-show="open" class="px-4 pb-4 pt-1">
      <div class="grid gap-4 md:grid-cols-4">
        <!-- PostGIS: расстояние -->
        <div class="rounded-lg bg-slate-800/70 p-3 border border-slate-700">
          <div class="text-[11px] uppercase tracking-wide text-emerald-400 mb-1">
            PostGIS · ST_Distance
          </div>
          <div class="text-2xl font-semibold tabular-nums">{{ distanceLabel }}</div>
          <div class="text-xs text-slate-400 mt-1">Остаток пути по дороге до клиента</div>
        </div>

        <!-- TimescaleDB: средняя скорость -->
        <div class="rounded-lg bg-slate-800/70 p-3 border border-slate-700">
          <div class="text-[11px] uppercase tracking-wide text-sky-400 mb-1">
            TimescaleDB · avg за 10 мин
          </div>
          <div class="text-2xl font-semibold tabular-nums">{{ avgSpeedLabel }}</div>
          <div class="text-xs text-slate-400 mt-1">
            {{ stats?.totalPoints ?? 0 }} точек телеметрии
          </div>
        </div>

        <!-- Назначенный водитель -->
        <div class="rounded-lg bg-slate-800/70 p-3 border border-slate-700">
          <div class="text-[11px] uppercase tracking-wide text-blue-400 mb-1">Водитель</div>
          <div class="text-lg font-semibold truncate">
            {{ order?.taxi.driver_name ?? '—' }}
          </div>
          <div class="text-xs text-slate-400 mt-1">
            {{ order ? `taxi_id = ${order.taxi.id}` : 'заказ не создан' }}
          </div>
        </div>

        <!-- Состояние мира -->
        <div class="rounded-lg bg-slate-800/70 p-3 border border-slate-700">
          <div class="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Парк</div>
          <div class="text-2xl font-semibold tabular-nums">{{ taxiCount }}</div>
          <div class="text-xs text-slate-400 mt-1">машин в симуляции</div>
        </div>
      </div>

      <!-- График time_bucket -->
      <div class="mt-4 rounded-lg bg-slate-800/70 p-3 border border-slate-700">
        <div class="flex items-center justify-between mb-2">
          <div class="text-[11px] uppercase tracking-wide text-sky-400">
            time_bucket('1 minute') — средняя скорость по минутам
          </div>
          <button
            class="text-[11px] text-slate-400 hover:text-slate-200 underline underline-offset-2"
            @click="showSql = !showSql"
          >
            {{ showSql ? 'скрыть SQL' : 'показать SQL' }}
          </button>
        </div>

        <div v-if="stats && stats.buckets.length" class="flex items-end gap-1" style="height: 96px">
          <div
            v-for="b in stats.buckets"
            :key="b.bucket"
            class="flex-1 flex flex-col items-center justify-end h-full group"
          >
            <!-- Высота в px, а не в %: процент считается от flex-родителя без явной
                 высоты и схлопывается в ноль. Math.max держит видимым низкий бакет. -->
            <div
              class="w-full bg-sky-500/80 rounded-t group-hover:bg-sky-400 transition-all"
              :style="{ height: `${Math.max(4, (b.avg_speed_kmh / maxBucketSpeed) * 78)}px` }"
              :title="`${b.avg_speed_kmh.toFixed(1)} км/ч · ${b.points} точек`"
            />
            <div class="text-[10px] text-slate-500 mt-1 whitespace-nowrap">
              {{ bucketTime(b.bucket) }}
            </div>
          </div>
        </div>
        <div v-else class="text-sm text-slate-500 py-6 text-center">
          Вызовите такси — здесь появится агрегация телеметрии
        </div>
      </div>

      <!-- SQL, которым это считается -->
      <div v-show="showSql" class="mt-3 grid gap-3 md:grid-cols-3">
        <div>
          <div class="text-[11px] text-emerald-400 mb-1">Поиск ближайшего (k-NN)</div>
          <pre class="text-[10px] bg-slate-950 rounded p-2 overflow-x-auto text-slate-300">{{ KNN_SQL }}</pre>
        </div>
        <div>
          <div class="text-[11px] text-emerald-400 mb-1">Дистанция в метрах</div>
          <pre class="text-[10px] bg-slate-950 rounded p-2 overflow-x-auto text-slate-300">{{ DISTANCE_SQL }}</pre>
        </div>
        <div>
          <div class="text-[11px] text-sky-400 mb-1">Агрегация телеметрии</div>
          <pre class="text-[10px] bg-slate-950 rounded p-2 overflow-x-auto text-slate-300">{{ BUCKET_SQL }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>
