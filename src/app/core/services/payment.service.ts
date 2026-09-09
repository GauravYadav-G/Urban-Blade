import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, tap, throwError } from 'rxjs';

export interface CheckoutItemRequest {
  productId: string;
  quantity: number;
}

export interface ShippingAddress {
  fullName: string;
  phone: string;
  street: string;
  city?: string;
  postalCode?: string;
}

export interface CheckoutSessionResponse {
  orderId: string;
  subtotal: number;
  shippingFee: number;
  totalAmount: number;
  currency: string;
  signatureToken: string;
  expiresAt: number;
  paymentMethod: 'upi' | 'card' | 'cash_on_delivery';
  items: Array<{
    productId: string;
    productName: string;
    unitPrice: number;
    quantity: number;
    imageUrl: string;
  }>;
  shippingAddress: ShippingAddress;
}

export interface PaymentVerificationRequest {
  orderId: string;
  paymentId: string;
  signatureToken: string;
  expiresAt: number;
  paymentDetails?: {
    upiVpa?: string;
    cardLast4?: string;
    network?: string;
    method?: string;
  };
}

export interface PaymentReceipt {
  success: boolean;
  orderId: string;
  paymentId: string;
  receiptNumber: string;
  status: 'confirmed';
  paymentStatus: 'captured';
  totalAmount: number;
  currency: string;
  confirmedAt: string;
  shippingAddress: ShippingAddress;
  items: Array<{
    id: string;
    product_name: string;
    unit_price: number;
    quantity: number;
    image_url?: string;
  }>;
  paymentDetails?: any;
}

const API_BASE =
  typeof window !== 'undefined' && window.location.port === '4200'
    ? 'http://localhost:4000/api'
    : '/api';

@Injectable({ providedIn: 'root' })
export class PaymentService {
  private readonly http = inject(HttpClient);

  readonly activeSession = signal<CheckoutSessionResponse | null>(null);
  readonly isProcessing = signal<boolean>(false);
  readonly lastReceipt = signal<PaymentReceipt | null>(null);

  /**
   * Phase 1: Atomically lock inventory in Neon PostgreSQL and generate HMAC payment session
   */
  createCheckoutSession(payload: {
    items: CheckoutItemRequest[];
    shippingAddress: ShippingAddress;
    paymentMethod: 'upi' | 'card' | 'cash_on_delivery';
    userId?: string;
  }): Observable<CheckoutSessionResponse> {
    this.isProcessing.set(true);

    return this.http
      .post<CheckoutSessionResponse>(`${API_BASE}/orders/checkout-session`, payload, {
        headers: {
          'x-idempotency-key': `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
      })
      .pipe(
        tap((session) => {
          this.activeSession.set(session);
          this.isProcessing.set(false);
        }),
        catchError((err) => {
          this.isProcessing.set(false);
          return throwError(() => err);
        })
      );
  }

  /**
   * Phase 2: Cryptographically verify HMAC-SHA256 signature and finalize order in Neon DB
   */
  verifyPayment(payload: PaymentVerificationRequest): Observable<PaymentReceipt> {
    this.isProcessing.set(true);

    return this.http.post<PaymentReceipt>(`${API_BASE}/orders/verify-payment`, payload).pipe(
      tap((receipt) => {
        this.lastReceipt.set(receipt);
        this.activeSession.set(null);
        this.isProcessing.set(false);
      }),
      catchError((err) => {
        this.isProcessing.set(false);
        return throwError(() => err);
      })
    );
  }

  /**
   * Phase 3 (Rollback): Release reserved inventory back to Neon DB if user cancels
   */
  cancelPayment(orderId: string, reason?: string): Observable<any> {
    this.isProcessing.set(true);

    return this.http
      .post(`${API_BASE}/orders/cancel-payment`, { orderId, reason })
      .pipe(
        tap(() => {
          this.activeSession.set(null);
          this.isProcessing.set(false);
        }),
        catchError((err) => {
          this.isProcessing.set(false);
          return throwError(() => err);
        })
      );
  }
}
