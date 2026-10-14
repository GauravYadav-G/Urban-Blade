import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import type { AdminOrder } from './admin.service';
import type { ReturnEvent, ReturnReviewStatus, ReturnStatus } from '@core/models/order-return.model';

export interface ReturnQueue {
  data: AdminOrder[];
  total: number;
  page: number;
  limit: number;
}

export interface ReturnAudit {
  order: AdminOrder;
  events: ReturnEvent[];
}

export interface ReturnMutation {
  ok: boolean;
  order: AdminOrder;
  returnStatus?: ReturnStatus;
  message?: string;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid return record');
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeReturnOrder(value: unknown): AdminOrder {
  const raw = objectValue(value);
  const total = Number(raw['total_amount']);
  if (!stringValue(raw['id']) || !Array.isArray(raw['items']) || !Number.isFinite(total) || total < 0) throw new Error('Invalid return order');
  const returnStatus = raw['return_status'];
  if (returnStatus != null && !['requested', 'approved', 'rejected', 'received'].includes(String(returnStatus))) throw new Error('Invalid return status');
  let address: Record<string, unknown> = {};
  try {
    const addressValue: unknown = typeof raw['shipping_address'] === 'string' ? JSON.parse(raw['shipping_address']) : raw['shipping_address'];
    if (addressValue) address = objectValue(addressValue);
  } catch { /* Missing legacy addresses remain safe to display. */ }
  const items = raw['items'].map(value => {
    const item = objectValue(value);
    const quantity = Number(item['quantity']);
    const unitPrice = Number(item['unit_price']);
    if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Invalid return item');
    return { ...item, product_name: stringValue(item['product_name'], 'Product'), quantity, unit_price: unitPrice } as AdminOrder['items'][number];
  });
  return {
    ...raw,
    id: stringValue(raw['id']),
    total_amount: total,
    subtotal: Number(raw['subtotal']) || total,
    currency: stringValue(raw['currency'], 'INR'),
    payment_method: stringValue(raw['payment_method']),
    payment_status: stringValue(raw['payment_status']),
    refund_amount: raw['refund_amount'] == null ? undefined : Number(raw['refund_amount']),
    shipping_address: {
      ...address,
      fullName: stringValue(address['fullName'], stringValue(address['name'], 'Customer')),
      phone: stringValue(address['phone']),
      email: stringValue(address['email']),
      city: stringValue(address['city']),
      street: stringValue(address['street']),
    },
    items,
  } as AdminOrder;
}

function normalizeMutation(value: ReturnMutation): ReturnMutation {
  if (value?.ok !== true) throw new Error('Unconfirmed return update');
  return { ...value, order: normalizeReturnOrder(value.order) };
}

@Injectable({ providedIn: 'root' })
export class ReturnsService {
  private readonly http = inject(HttpClient);

  queue(status: ReturnStatus | 'all', page: number, query = ''): Observable<ReturnQueue> {
    const params = new HttpParams().set('status', status).set('page', page).set('limit', 25).set('q', query);
    return this.http.get<ReturnQueue>('/api/admin/returns', { params }).pipe(map(response => {
      if (!Array.isArray(response?.data) || !Number.isInteger(Number(response.total)) || Number(response.total) < 0 ||
          !Number.isInteger(Number(response.page)) || Number(response.page) < 1 || !Number.isInteger(Number(response.limit)) || Number(response.limit) < 1) throw new Error('Invalid return queue');
      return { ...response, total: Number(response.total), page: Number(response.page), limit: Number(response.limit), data: response.data.map(normalizeReturnOrder) };
    }));
  }

  audit(orderId: string): Observable<ReturnAudit> {
    return this.http.get<ReturnAudit>(`/api/admin/orders/${encodeURIComponent(orderId)}/return`).pipe(map(response => {
      if (!Array.isArray(response?.events)) throw new Error('Invalid return history');
      const events = response.events.map(value => {
        const event = objectValue(value);
        if (!stringValue(event['id']) || !['requested', 'approved', 'rejected', 'received'].includes(String(event['status']))) throw new Error('Invalid return event');
        return { ...event, note: stringValue(event['note']), actor_name: stringValue(event['actor_name']), source: stringValue(event['source']), created_at: stringValue(event['created_at']) } as unknown as ReturnEvent;
      });
      return { order: normalizeReturnOrder(response.order), events };
    }));
  }

  request(orderId: string, reason: string, admin = false): Observable<ReturnMutation> {
    const base = admin ? '/api/admin/orders' : '/api/orders';
    return this.http.post<ReturnMutation>(`${base}/${encodeURIComponent(orderId)}/return`, { reason }).pipe(map(normalizeMutation));
  }

  review(orderId: string, status: ReturnReviewStatus, note: string, restock?: boolean): Observable<ReturnMutation> {
    const body = status === 'received' ? { status, note, restock } : { status, note };
    return this.http.put<ReturnMutation>(`/api/admin/orders/${encodeURIComponent(orderId)}/return`, body).pipe(map(normalizeMutation));
  }

  recordManualRefund(orderId: string, reference: string, reason: string): Observable<ReturnMutation> {
    return this.http.post<ReturnMutation>(`/api/admin/orders/${encodeURIComponent(orderId)}/refund/manual`, { reference, reason }).pipe(map(normalizeMutation));
  }
}
