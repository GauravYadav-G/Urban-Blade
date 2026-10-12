import { getCarrierConnection } from './carrier-connection.service.js';
import { bookDueShipments } from './carrier-booking.service.js';
import { query } from '../../db/pool.js';
import { syncOrderFromCarrierWebsite } from './carrier-portal.service.js';

interface TrackingJob {
  id: string;
  tracking_number: string;
  carrier: string | null;
  tracking_failures: number;
}
interface WorkerLogger {
  warn(message: string): void;
  error(error: unknown, message: string): void;
}

export function retryDelaySeconds(failures: number): number {
  return Math.min(3600, 60 * 2 ** Math.min(Math.max(failures, 0), 6));
}

export async function syncDueCarrierOrders(): Promise<number> {
  const connection = await getCarrierConnection();
  if (!connection.configured || !connection.enabled) return 0;
  // Atomic leases prevent duplicate background work across clustered processes.
  // Ten sequential requests have an 80-second timeout ceiling, below the lease.
  const jobs = await query<TrackingJob>(`WITH due AS (
    SELECT id FROM orders WHERE status IN ('processing','shipped')
      AND NULLIF(TRIM(tracking_number),'') IS NOT NULL
      AND (carrier ILIKE '%delhivery%' OR (NULLIF(TRIM(carrier),'') IS NULL AND tracking_number ILIKE 'DEL%'))
      AND tracking_next_check_at <= NOW()
    ORDER BY tracking_next_check_at, id FOR UPDATE SKIP LOCKED LIMIT 10
  ) UPDATE orders o SET tracking_next_check_at=NOW()+INTERVAL '2 minutes'
    FROM due WHERE o.id=due.id
    RETURNING o.id,o.tracking_number,o.carrier,o.tracking_failures`);
  for (const job of jobs.rows) {
    try {
      await syncOrderFromCarrierWebsite(job.id);
    } catch (error) {
      const code = error instanceof Error && /^CARRIER_[A-Z_]+$/.test(error.message)
        ? error.message : 'CARRIER_SYNC_FAILED';
      await query(`UPDATE orders SET tracking_error=$2, tracking_failures=tracking_failures+1,
        tracking_next_check_at=NOW()+($3*INTERVAL '1 second')
        WHERE id=$1 AND tracking_number=$4 AND carrier IS NOT DISTINCT FROM $5`,
      [job.id, code, retryDelaySeconds(job.tracking_failures + 1), job.tracking_number, job.carrier]);
    }
  }
  return jobs.rows.length;
}

export function startCarrierTrackingWorker(logger: WorkerLogger): () => Promise<void> {
  if (process.env.CARRIER_TRACKING_ENABLED === 'false') return async () => {};
  let running: Promise<unknown> | undefined;
  const timer = setInterval(() => {
    if (running) return;
    running = bookDueShipments().then(() => syncDueCarrierOrders())
      .catch(error => logger.error(error, 'Carrier tracking worker failed'))
      .finally(() => { running = undefined; });
  }, 15_000);
  timer.unref();
  return async () => { clearInterval(timer); await running; };
}
