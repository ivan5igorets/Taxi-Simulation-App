export type TaxiStatus = 'IDLE' | 'SEARCHING' | 'ON_THE_WAY';

export interface Taxi {
  id: number;
  driver_name: string;
  status: TaxiStatus;
  lat: number;
  lon: number;
}

/** Точки маршрута в порядке [lat, lon] — готовы для Leaflet L.polyline. */
export type RoutePoints = [number, number][];

export interface OrderResponse {
  orderId: number;
  createdAt: string;
  distance_m: number;
  /** Реальный путь по улицам (OSRM); null — OSRM недоступен, используется прямая. */
  route: RoutePoints | null;
  route_distance_m: number | null;
  taxi: { id: number; driver_name: string; lat: number; lon: number };
}

export interface OrderState {
  id: number;
  status: 'PENDING' | 'ASSIGNED' | 'COMPLETED';
  assigned_taxi_id: number | null;
  initial_distance_m: number;
  route_distance_m: number | null;
  /** Остаток пути по дороге от текущей позиции такси до клиента; null без маршрута. */
  remaining_route_distance_m: number | null;
  user_lat: number;
  user_lon: number;
  current_distance_m: number | null;
  route: RoutePoints | null;
}

export interface TelemetryBucket {
  bucket: string;
  avg_speed_kmh: number;
  points: number;
}

export interface TelemetryStats {
  taxiId: number;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  totalPoints: number;
  buckets: TelemetryBucket[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    throw new ApiError(
      (body.message as string) ?? `Ошибка запроса ${res.status}`,
      res.status,
      body.error as string | undefined,
    );
  }

  return res.json() as Promise<T>;
}

export const api = {
  getTaxis: () => request<Taxi[]>('/api/taxis'),

  createOrder: (lat: number, lon: number) =>
    request<OrderResponse>('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ lat, lon }),
    }),

  getOrder: (id: number) => request<OrderState>(`/api/orders/${id}`),

  getStats: (taxiId: number) => request<TelemetryStats>(`/api/telemetry/stats/${taxiId}`),

  reset: () => request<{ ok: boolean; taxis: number }>('/api/reset', { method: 'POST' }),
};
