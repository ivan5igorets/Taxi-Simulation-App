export type TaxiStatus = 'IDLE' | 'SEARCHING' | 'ON_THE_WAY';
export type OrderStatus = 'PENDING' | 'ASSIGNED' | 'COMPLETED';

export interface Taxi {
  id: number;
  driver_name: string;
  status: TaxiStatus;
  lat: number;
  lon: number;
}

export interface AssignedTaxi extends Taxi {
  distance_m: number;
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
