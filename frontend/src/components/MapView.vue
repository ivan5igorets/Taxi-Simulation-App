<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Taxi } from '../api/client';
import { CITY } from '../config';

const props = defineProps<{
  taxis: Taxi[];
  userPoint: { lat: number; lon: number } | null;
  assignedTaxiId: number | null;
}>();

const mapEl = ref<HTMLDivElement | null>(null);
let map: L.Map | null = null;
let userMarker: L.Marker | null = null;
let routeLine: L.Polyline | null = null;

// Маркеры переиспользуются по id: пересоздание на каждом опросе сбрасывало бы
// анимацию и «дёргало» карту.
const markers = new Map<number, L.Marker>();

function taxiIcon(status: Taxi['status'], assigned: boolean): L.DivIcon {
  const color = status === 'IDLE' ? '#facc15' : '#3b82f6';
  const ring = assigned
    ? '<span class="absolute inset-0 rounded-full animate-ping" style="background:#3b82f6;opacity:.55"></span>'
    : '';
  return L.divIcon({
    className: 'taxi-marker',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<div class="relative w-[26px] h-[26px]">${ring}
      <div class="relative w-[26px] h-[26px] rounded-full border-2 border-white shadow-md
                  flex items-center justify-center text-[13px] leading-none"
           style="background:${color}">🚕</div></div>`,
  });
}

function userIcon(): L.DivIcon {
  return L.divIcon({
    className: 'user-marker',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div class="w-[28px] h-[28px] rounded-full border-2 border-white shadow-md
                       flex items-center justify-center text-[14px] leading-none"
                style="background:#22c55e">🧍</div>`,
  });
}

function syncTaxis(): void {
  if (!map) return;
  const seen = new Set<number>();

  for (const taxi of props.taxis) {
    seen.add(taxi.id);
    const assigned = taxi.id === props.assignedTaxiId;
    const existing = markers.get(taxi.id);

    if (existing) {
      existing.setLatLng([taxi.lat, taxi.lon]);
      existing.setIcon(taxiIcon(taxi.status, assigned));
      existing.setTooltipContent(`${taxi.driver_name} — ${taxi.status}`);
    } else {
      const marker = L.marker([taxi.lat, taxi.lon], { icon: taxiIcon(taxi.status, assigned) })
        .addTo(map)
        .bindTooltip(`${taxi.driver_name} — ${taxi.status}`, { direction: 'top' });
      markers.set(taxi.id, marker);
    }
  }

  // Машины, исчезнувшие после reset, убираем с карты.
  for (const [id, marker] of markers) {
    if (!seen.has(id)) {
      marker.remove();
      markers.delete(id);
    }
  }

  syncRoute();
}

/** Линия от назначенного такси до клиента — визуализация ST_Distance. */
function syncRoute(): void {
  if (!map) return;
  const assigned = props.taxis.find((t) => t.id === props.assignedTaxiId);

  if (!assigned || !props.userPoint) {
    routeLine?.remove();
    routeLine = null;
    return;
  }

  const path: L.LatLngExpression[] = [
    [assigned.lat, assigned.lon],
    [props.userPoint.lat, props.userPoint.lon],
  ];

  if (routeLine) {
    routeLine.setLatLngs(path);
  } else {
    routeLine = L.polyline(path, {
      color: '#3b82f6',
      weight: 3,
      dashArray: '8 6',
      opacity: 0.8,
    }).addTo(map);
  }
}

function syncUser(): void {
  if (!map) return;

  if (!props.userPoint) {
    userMarker?.remove();
    userMarker = null;
    return;
  }

  const pos: L.LatLngExpression = [props.userPoint.lat, props.userPoint.lon];
  if (userMarker) {
    userMarker.setLatLng(pos);
  } else {
    userMarker = L.marker(pos, { icon: userIcon(), zIndexOffset: 1000 })
      .addTo(map)
      .bindTooltip('Вы здесь', { direction: 'top' });
  }
}

onMounted(() => {
  if (!mapEl.value) return;

  map = L.map(mapEl.value, { zoomControl: true }).setView([CITY.lat, CITY.lon], CITY.zoom);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  }).addTo(map);

  // Граница зоны симуляции — чтобы было видно, откуда берутся машины.
  L.circle([CITY.lat, CITY.lon], {
    radius: CITY.spawnRadiusM,
    color: '#64748b',
    weight: 1,
    fillOpacity: 0.04,
    dashArray: '4 6',
  }).addTo(map);

  syncUser();
  syncTaxis();
});

onUnmounted(() => {
  map?.remove();
  map = null;
  markers.clear();
});

watch(() => props.taxis, syncTaxis);
watch(() => props.assignedTaxiId, syncTaxis);
watch(() => props.userPoint, syncUser, { deep: true });
</script>

<template>
  <div ref="mapEl" class="h-full w-full z-0" />
</template>
