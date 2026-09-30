import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, tap, throwError, timeout } from 'rxjs';
import { AccountService } from './account.service';

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
  state?: string;
  email?: string;
}

export interface RazorpayOrderResponse {
  orderId: string;
  razorpayOrderId: string;
  amount: number; // in paise
  totalAmount: number; // in INR
  currency: string;
  keyId: string;
  items: Array<{
    productId: string;
    productName: string;
    unitPrice: number;
    quantity: number;
    imageUrl: string;
  }>;
  shippingAddress: ShippingAddress;
}

export interface RazorpayVerificationRequest {
  orderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export interface PaymentReceipt {
  success: boolean;
  orderId: string;
  paymentId: string;
  transactionId?: string;
  receiptNumber: string;
  status: 'confirmed';
  paymentStatus: 'captured' | 'pending';
  subtotal: number;
  shippingFee: number;
  discountAmount: number;
  couponCode?: string;
  taxAmount: number;
  taxInclusive: boolean;
  taxRatePercent: number;
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

export interface OrderQuote {
  subtotal: number; totalAmount: number; shippingFee: number; discountAmount: number;
  couponCode: string; taxAmount: number; taxInclusive: boolean; taxRatePercent: number;
  verifiedItems: Array<{ productId: string; slug?: string; unitPrice: number }>;
}

const API_BASE =
  typeof window !== 'undefined' && window.location.port === '4200'
    ? 'http://localhost:4000/api'
    : '/api';

@Injectable({ providedIn: 'root' })
export class PaymentService {
  private readonly http = inject(HttpClient);
  private readonly account = inject(AccountService);

  readonly isProcessing = signal<boolean>(false);
  readonly lastReceipt = signal<PaymentReceipt | null>(null);
  readonly activeRazorpayOrder = signal<RazorpayOrderResponse | null>(null);

  quoteOrder(items: CheckoutItemRequest[], couponCode?: string): Observable<OrderQuote> {
    return this.http.post<OrderQuote>(`${API_BASE}/orders/quote`, { items, couponCode }).pipe(timeout(30000));
  }
  reconcileOrder(orderId: string): Observable<{receipt?: PaymentReceipt; pending?: boolean; cancelled?: boolean}> {
    return this.http.post<any>(`${API_BASE}/orders/${encodeURIComponent(orderId)}/reconcile`, {}).pipe(timeout(30000));
  }
  rememberPendingOrder(order: RazorpayOrderResponse): void {
    try { sessionStorage.setItem('urban-blade-pending-payment', JSON.stringify({ user: this.account.user()?.email, order })); } catch {}
  }
  restorePendingOrder(): RazorpayOrderResponse | null {
    try { const saved = JSON.parse(sessionStorage.getItem('urban-blade-pending-payment') || 'null'); return saved?.user === this.account.user()?.email && saved?.order?.orderId ? saved.order : null; } catch { return null; }
  }
  clearPendingOrder(): void {
    this.activeRazorpayOrder.set(null);
    try { sessionStorage.removeItem('urban-blade-pending-payment'); sessionStorage.removeItem('checkout-attempt'); } catch {}
  }
  private attempt: { fingerprint: string; key: string } | null = null;
  private checkoutKey(method: string, payload: unknown): string {
    const fingerprint = JSON.stringify({ method, payload, user: this.account.user()?.email });
    if (this.attempt?.fingerprint === fingerprint) return this.attempt.key;
    try {
      const stored = JSON.parse(sessionStorage.getItem('checkout-attempt') || 'null');
      if (stored?.fingerprint === fingerprint && typeof stored.key === 'string') { this.attempt = stored; return stored.key; }
    } catch {}
    const key = crypto.randomUUID();
    this.attempt = { fingerprint, key };
    try { sessionStorage.setItem('checkout-attempt', JSON.stringify(this.attempt)); } catch {}
    return key;
  }
  private scriptPromise: Promise<boolean> | null = null;

  /**
   * Dynamically loads the official Razorpay Checkout JavaScript SDK
   */
  loadRazorpayScript(): Promise<boolean> {
    if (typeof window === 'undefined') return Promise.resolve(false);
    if ((window as any).Razorpay) return Promise.resolve(true);
    if (this.scriptPromise) return this.scriptPromise;
    this.scriptPromise = new Promise<boolean>(resolve => {
      let script = document.getElementById('razorpay-checkout-js') as HTMLScriptElement | null;
      const finish = (loaded: boolean) => {
        clearTimeout(timer);
        if (!loaded) { script?.remove(); this.scriptPromise = null; }
        resolve(loaded);
      };
      const timer = setTimeout(() => finish(false), 15000);
      if (!script) {
        script = document.createElement('script'); script.id = 'razorpay-checkout-js';
        script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.async = true;
        script.addEventListener('load', () => finish(!!(window as any).Razorpay), { once: true });
        script.addEventListener('error', () => finish(false), { once: true });
        document.body.appendChild(script);
      } else {
        script.addEventListener('load', () => finish(!!(window as any).Razorpay), { once: true });
        script.addEventListener('error', () => finish(false), { once: true });
      }
    });
    return this.scriptPromise;
  }

  /**
   * Phase 1: Atomically lock inventory in Neon PostgreSQL and generate Razorpay order
   */
  createRazorpayOrder(payload: {
    items: CheckoutItemRequest[];
    shippingAddress: ShippingAddress;
    userId?: string;
    couponCode?: string;
    discountAmount?: number;
    expectedTotal: number;
  }): Observable<RazorpayOrderResponse> {
    this.isProcessing.set(true);

    return this.http
      .post<RazorpayOrderResponse>(`${API_BASE}/orders/razorpay/create-order`, payload, { headers: { 'x-idempotency-key': this.checkoutKey('razorpay', payload) } })
      .pipe(
        timeout(30000),
        tap((order) => {
          this.isProcessing.set(false);
          this.activeRazorpayOrder.set(order);
        }),
        catchError((err) => {
          this.isProcessing.set(false);
          return throwError(() => err);
        })
      );
  }

  /**
   * Phase 2: Cryptographically verify Razorpay HMAC signature and finalize order in Neon DB
   */
  verifyRazorpayPayment(payload: RazorpayVerificationRequest): Observable<PaymentReceipt> {
    this.isProcessing.set(true);

    return this.http
      .post<PaymentReceipt>(`${API_BASE}/orders/razorpay/verify`, payload)
      .pipe(
        timeout(30000),
        tap((receipt) => {
          this.lastReceipt.set(receipt);
          this.attempt = null;
          try { sessionStorage.removeItem('checkout-attempt'); } catch {}
          this.isProcessing.set(false);
        }),
        catchError((err) => {
          this.isProcessing.set(false);
          return throwError(() => err);
        })
      );
  }

  /**
   * Cash on Delivery (COD) 1-Click Order Placement
   */
  placeCodOrder(payload: {
    items: CheckoutItemRequest[];
    shippingAddress: ShippingAddress;
    userId?: string;
    couponCode?: string;
    discountAmount?: number;
    expectedTotal: number;
  }): Observable<PaymentReceipt> {
    this.isProcessing.set(true);

    return this.http
      .post<PaymentReceipt>(`${API_BASE}/orders/cod-order`, payload, { headers: { 'x-idempotency-key': this.checkoutKey('cod', payload) } })
      .pipe(
        timeout(30000),
        tap((receipt) => {
          this.lastReceipt.set(receipt);
          this.attempt = null;
          try { sessionStorage.removeItem('checkout-attempt'); } catch {}
          this.isProcessing.set(false);
        }),
        catchError((err) => {
          this.isProcessing.set(false);
          return throwError(() => err);
        })
      );
  }

  /**
   * Launch official Razorpay Checkout popup modal
   */
  async launchRazorpayCheckout(
    orderData: RazorpayOrderResponse,
    callbacks: {
      onSuccess: (response: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
      }) => void;
      onDismiss?: () => void;
      onError?: (err: any) => void;
    }
  ): Promise<void> {
    const isLoaded = await this.loadRazorpayScript();
    if (!isLoaded || !(window as any).Razorpay) {
      callbacks.onError?.({ description: 'Payment gateway could not load. Please check your connection and try again.' });
      return;
    }

    const cleanPhone = (orderData.shippingAddress.phone || '').replace(/\D/g, '').slice(-10);


    let completed = false;
    const options: any = {
      timeout: 900,
      key: orderData.keyId,
      order_id: orderData.razorpayOrderId,
      amount: orderData.amount,
      currency: orderData.currency || 'INR',
      name: 'Urban Blade Luxury Salon',
      description: `Order #${orderData.orderId.slice(0, 8).toUpperCase()}`,
      prefill: {
        name: orderData.shippingAddress.fullName,
        contact: cleanPhone,
        email: this.account.user()?.email || 'customer@urbanblade.in',
      },
      notes: {
        orderId: orderData.orderId,
        city: orderData.shippingAddress.city || 'Ghaziabad',
      },
      theme: {
        color: '#0f172a',
      },
      modal: {
        backdropclose: true,
        escape: true,
        handleback: true,
        confirm_close: true,
        ondismiss: () => {
          if (!completed) callbacks.onDismiss?.();
        },
      },
      handler: (response: any) => {
        if (completed) return;
        completed = true;
        callbacks.onSuccess({
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_order_id: response.razorpay_order_id || orderData.razorpayOrderId,
          razorpay_signature: response.razorpay_signature,
        });
      },
    };


    try {
      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', (errResp: any) => {
        if (completed) return;
        completed = true;
        rzp.close();
        callbacks.onError?.(errResp?.error);
      });
      rzp.open();
    } catch (err) {
      if (callbacks.onError) callbacks.onError(err);
    }
  }

  cancelPayment(orderId: string, reason?: string): Observable<any> {
    return this.http.post(`${API_BASE}/orders/cancel-payment`, { orderId, reason });
  }
}
