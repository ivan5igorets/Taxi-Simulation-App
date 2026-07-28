<script setup lang="ts">
import type { OrderPhase } from '../composables/useOrder';
import type { OrderResponse } from '../api/client';

defineProps<{
  phase: OrderPhase;
  countdown: number;
  order: OrderResponse | null;
  error: string | null;
  resetting: boolean;
}>();

const emit = defineEmits<{ call: []; reset: [] }>();
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <button
      class="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium shadow
             hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed
             transition-colors"
      :disabled="phase === 'searching' || phase === 'assigned' || resetting"
      @click="emit('call')"
    >
      Вызвать такси
    </button>

    <button
      class="px-4 py-2 rounded-lg bg-slate-700 text-white font-medium shadow
             hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed
             transition-colors"
      :disabled="resetting"
      @click="emit('reset')"
    >
      {{ resetting ? 'Сброс…' : 'Перезапустить мир' }}
    </button>

    <!-- Поиск водителя: спиннер + обратный отсчёт (случайные 5–50 с) -->
    <div
      v-if="phase === 'searching'"
      class="flex items-center gap-2 text-sm text-amber-300"
    >
      <span
        class="inline-block w-4 h-4 border-2 border-amber-300 border-t-transparent
               rounded-full animate-spin"
      />
      <span>Ищем ближайшего водителя… {{ countdown }} с</span>
    </div>

    <div v-else-if="phase === 'assigned' && order" class="text-sm text-blue-300">
      Водитель <span class="font-semibold">{{ order.taxi.driver_name }}</span> уже в пути
    </div>

    <div v-else-if="phase === 'completed'" class="text-sm text-emerald-300">
      Такси прибыло — заказ выполнен
    </div>

    <div v-else-if="phase === 'error'" class="text-sm text-rose-400">
      {{ error }}
    </div>
  </div>
</template>
