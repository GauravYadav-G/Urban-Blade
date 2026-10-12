export interface ShipmentTracking {
  carrier: string;
  awb: string;
  rawPortalStatus: string;
  currentLocation: string;
  lastScanTime: string;
  expectedDelivery: string;
  checkedAt: string;
  source: string;
  checkpoints: Array<{ stage: string; location: string; timestamp: string; activity: string }>;
}
export interface TrackedOrder {
  tracking_number?: string;
  carrier?: string;
  tracking_data?: ShipmentTracking | null;
  tracking_checked_at?: string | null;
  tracking_error?: string | null;
  tracking_automatic?: boolean;
}
