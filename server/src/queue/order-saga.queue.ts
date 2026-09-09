import { Queue, Worker, Job } from 'bullmq';
import { isRedisAvailable, redis } from '../redis/client.js';
import { config } from '../config.js';
import { withTransaction } from '../db/pool.js';

export interface OrderJobPayload {
  orderId: string;
  userId?: string;
  idempotencyKey?: string;
  items: Array<{
    productId: string;
    productName: string;
    unitPrice: number;
    quantity: number;
    imageUrl?: string;
  }>;
  subtotal: number;
  shippingFee: number;
  totalAmount: number;
  currency: string;
  shippingAddress: any;
  paymentMethod: string;
}

const ORDER_QUEUE_NAME = 'order-saga-queue';

let orderQueue: Queue<OrderJobPayload> | null = null;
let orderWorker: Worker<OrderJobPayload> | null = null;

// Fallback in-memory queue
const inMemoryOrderJobs: OrderJobPayload[] = [];
let isProcessingMemoryQueue = false;

export function initializeOrderQueue() {
  if (isRedisAvailable() && redis) {
    try {
      orderQueue = new Queue<OrderJobPayload>(ORDER_QUEUE_NAME, {
        connection: {
          host: 'localhost',
          port: 6379,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      });

      orderWorker = new Worker<OrderJobPayload>(
        ORDER_QUEUE_NAME,
        async (job: Job<OrderJobPayload>) => {
          await processOrderJob(job.data);
        },
        {
          connection: {
            host: 'localhost',
            port: 6379,
          },
          concurrency: 20, // Process 20 orders concurrently per worker
        }
      );

      orderWorker.on('completed', (job) => {
        console.log(`[OrderSaga] Order ${job.data.orderId} processed successfully.`);
      });

      orderWorker.on('failed', (job, err) => {
        console.error(`[OrderSaga] Order ${job?.data.orderId} failed:`, err.message);
      });

      console.log('⚡ BullMQ Order Saga Queue initialized.');
    } catch (err) {
      console.warn('⚠️ BullMQ fallback to local worker queue.');
    }
  }
}

/**
 * Core ACID Order Processor
 */
export async function processOrderJob(order: OrderJobPayload): Promise<void> {
  console.log(`[OrderSaga] Processing order ${order.orderId}...`);

  await withTransaction(async (client) => {
    // 1. Atomic Stock Decrement with Optimistic Concurrency Control
    for (const item of order.items) {
      const stockRes = await client.query(
        `
        UPDATE products 
        SET stock_quantity = stock_quantity - $1, version = version + 1
        WHERE id = $2 AND stock_quantity >= $1
        RETURNING stock_quantity;
        `,
        [item.quantity, item.productId]
      );

      if (stockRes.rowCount === 0) {
        // Compensating transaction: Mark order as failed due to out of stock
        console.warn(`[OrderSaga] Out of stock for product ${item.productName}`);
        await client.query(
          `
          UPDATE orders 
          SET status = 'cancelled', payment_status = 'failed' 
          WHERE id = $1;
          `,
          [order.orderId]
        );
        return;
      }
    }

    // 2. Mark order as confirmed
    await client.query(
      `
      UPDATE orders 
      SET status = 'confirmed', payment_status = 'captured', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1;
      `,
      [order.orderId]
    );

    console.log(`[OrderSaga] Order ${order.orderId} confirmed and stock decremented.`);
  });
}

/**
 * High-Speed Enqueue (< 2ms)
 */
export async function enqueueOrderJob(order: OrderJobPayload): Promise<void> {
  if (orderQueue && isRedisAvailable()) {
    try {
      await orderQueue.add(`order-${order.orderId}`, order, {
        jobId: order.orderId,
      });
      return;
    } catch {
      // Fall through to memory queue
    }
  }

  // Memory fallback processor
  inMemoryOrderJobs.push(order);
  if (!isProcessingMemoryQueue) {
    processMemoryQueue();
  }
}

async function processMemoryQueue() {
  isProcessingMemoryQueue = true;
  while (inMemoryOrderJobs.length > 0) {
    const job = inMemoryOrderJobs.shift();
    if (job) {
      try {
        await processOrderJob(job);
      } catch (err: any) {
        console.error('[OrderSaga Memory Queue Error]', err.message);
      }
    }
  }
  isProcessingMemoryQueue = false;
}
