import { onUnmounted, ref, shallowRef } from 'vue';
import { api, type Taxi } from '../api/client';
import { TAXI_POLL_MS } from '../config';

export function useTaxis() {
  const taxis = shallowRef<Taxi[]>([]);
  const error = ref<string | null>(null);
  let timer: number | null = null;

  async function refresh(): Promise<void> {
    try {
      taxis.value = await api.getTaxis();
      error.value = null;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Не удалось загрузить такси';
    }
  }

  function start(): void {
    stop();
    void refresh();
    timer = window.setInterval(() => void refresh(), TAXI_POLL_MS);
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  onUnmounted(stop);

  return { taxis, error, refresh, start, stop };
}
