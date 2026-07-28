import { computed, onUnmounted, ref } from 'vue';
import {
  ApiError,
  api,
  type OrderResponse,
  type OrderState,
  type TelemetryStats,
} from '../api/client';
import { SEARCH_DELAY, STATS_POLL_MS } from '../config';

export type OrderPhase = 'idle' | 'searching' | 'assigned' | 'completed' | 'error';

export function useOrder() {
  const phase = ref<OrderPhase>('idle');
  const countdown = ref(0);
  const order = ref<OrderResponse | null>(null);
  const orderState = ref<OrderState | null>(null);
  const stats = ref<TelemetryStats | null>(null);
  const error = ref<string | null>(null);

  let countdownTimer: number | null = null;
  let statsTimer: number | null = null;

  const isBusy = computed(() => phase.value === 'searching' || phase.value === 'assigned');

  /** Текущее расстояние до клиента: из живого состояния заказа, иначе — из момента назначения. */
  const distanceM = computed(
    () => orderState.value?.current_distance_m ?? order.value?.distance_m ?? null,
  );

  function clearTimers(): void {
    if (countdownTimer !== null) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (statsTimer !== null) {
      clearInterval(statsTimer);
      statsTimer = null;
    }
  }

  async function pollAssigned(): Promise<void> {
    const current = order.value;
    if (!current) return;

    try {
      const [state, telemetry] = await Promise.all([
        api.getOrder(current.orderId),
        api.getStats(current.taxi.id),
      ]);
      orderState.value = state;
      stats.value = telemetry;

      if (state.status === 'COMPLETED') {
        phase.value = 'completed';
        clearTimers();
      }
    } catch {
      // Разовый сбой опроса не должен ронять UI — следующий тик повторит.
    }
  }

  /**
   * По ТЗ: случайная задержка 5–50 с с видимым отсчётом («Ищем ближайшего водителя…»),
   * и только по её истечении — реальный запрос на бекенд.
   */
  function callTaxi(userLat: number, userLon: number): void {
    reset();
    phase.value = 'searching';

    const delay =
      SEARCH_DELAY.min + Math.floor(Math.random() * (SEARCH_DELAY.max - SEARCH_DELAY.min + 1));
    countdown.value = delay;

    countdownTimer = window.setInterval(() => {
      countdown.value -= 1;
      if (countdown.value > 0) return;

      clearTimers();
      void (async () => {
        try {
          order.value = await api.createOrder(userLat, userLon);
          phase.value = 'assigned';
          void pollAssigned();
          statsTimer = window.setInterval(() => void pollAssigned(), STATS_POLL_MS);
        } catch (err) {
          phase.value = 'error';
          error.value =
            err instanceof ApiError ? err.message : 'Не удалось назначить такси';
        }
      })();
    }, 1000);
  }

  function reset(): void {
    clearTimers();
    phase.value = 'idle';
    countdown.value = 0;
    order.value = null;
    orderState.value = null;
    stats.value = null;
    error.value = null;
  }

  onUnmounted(clearTimers);

  return {
    phase,
    countdown,
    order,
    orderState,
    stats,
    error,
    isBusy,
    distanceM,
    callTaxi,
    reset,
  };
}
