<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import MapView from './components/MapView.vue';
import ControlPanel from './components/ControlPanel.vue';
import MetricsPanel from './components/MetricsPanel.vue';
import { useTaxis } from './composables/useTaxis';
import { useOrder } from './composables/useOrder';
import { api } from './api/client';
import { CITY } from './config';

const { taxis, start: startPolling, refresh } = useTaxis();
const {
  phase,
  countdown,
  order,
  stats,
  error,
  distanceM,
  callTaxi,
  reset: resetOrder,
} = useOrder();

const userPoint = ref<{ lat: number; lon: number } | null>(null);
const resetting = ref(false);

const assignedTaxiId = computed(() =>
  phase.value === 'assigned' || phase.value === 'completed'
    ? (order.value?.taxi.id ?? null)
    : null,
);

/** Случайная точка клиента в радиусе города (равномерно по кругу). */
function randomUserPoint(): { lat: number; lon: number } {
  const r = CITY.spawnRadiusM * Math.sqrt(Math.random());
  const theta = Math.random() * 2 * Math.PI;
  const dLat = (r * Math.sin(theta)) / 111_320;
  const dLon = (r * Math.cos(theta)) / (111_320 * Math.cos((CITY.lat * Math.PI) / 180));
  return { lat: CITY.lat + dLat, lon: CITY.lon + dLon };
}

function onCall(): void {
  if (userPoint.value) callTaxi(userPoint.value.lat, userPoint.value.lon);
}

async function onReset(): Promise<void> {
  resetting.value = true;
  try {
    resetOrder();
    await api.reset();
    userPoint.value = randomUserPoint();
    await refresh();
  } finally {
    resetting.value = false;
  }
}

onMounted(() => {
  userPoint.value = randomUserPoint();
  startPolling();
});
</script>

<template>
  <div class="h-screen flex flex-col bg-slate-950">
    <header class="px-4 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 class="text-lg font-semibold text-slate-100">Taxi Simulation</h1>
          <p class="text-xs text-slate-400">
            Киев · PostGIS k-NN поиск + TimescaleDB телеметрия
          </p>
        </div>
        <ControlPanel
          :phase="phase"
          :countdown="countdown"
          :order="order"
          :error="error"
          :resetting="resetting"
          @call="onCall"
          @reset="onReset"
        />
      </div>
    </header>

    <main class="flex-1 relative min-h-0">
      <MapView :taxis="taxis" :user-point="userPoint" :assigned-taxi-id="assignedTaxiId" />

      <!-- Легенда -->
      <div
        class="absolute top-3 right-3 z-[400] bg-slate-900/90 backdrop-blur rounded-lg
               border border-slate-700 px-3 py-2 text-xs text-slate-300 space-y-1"
      >
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-emerald-500 border border-white" /> Клиент
        </div>
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-yellow-400 border border-white" /> Свободно (IDLE)
        </div>
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-blue-500 border border-white" /> В пути
        </div>
      </div>
    </main>

    <MetricsPanel
      class="shrink-0 max-h-[45vh] overflow-y-auto"
      :stats="stats"
      :order="order"
      :distance-m="distanceM"
      :taxi-count="taxis.length"
    />
  </div>
</template>
