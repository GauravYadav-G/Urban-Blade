import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, tap, throwError } from 'rxjs';
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

export interface CheckoutSessionResponse extends RazorpayOrderResponse {
  signatureToken?: string;
  expiresAt?: number;
  paymentMethod?: string;
}

export interface PaymentReceipt {
  success: boolean;
  orderId: string;
  paymentId: string;
  transactionId?: string;
  receiptNumber: string;
  status: 'confirmed';
  paymentStatus: 'captured' | 'pending';
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
  private readonly account = inject(AccountService);

  readonly isProcessing = signal<boolean>(false);
  readonly lastReceipt = signal<PaymentReceipt | null>(null);
  readonly activeRazorpayOrder = signal<RazorpayOrderResponse | null>(null);

  quoteOrder(items: CheckoutItemRequest[], couponCode?: string): Observable<{ totalAmount: number; discountAmount: number; verifiedItems: Array<{ productId: string; unitPrice: number }> }> {
    return this.http.post<any>(`${API_BASE}/orders/quote`, { items, couponCode });
  }

  private checkoutKey(method: string, payload: unknown): string {
    const fingerprint = JSON.stringify({ method, payload, user: this.account.user()?.email });
    const stored = sessionStorage.getItem('checkout-attempt');
    if (stored) {
      const attempt = JSON.parse(stored);
      if (attempt.fingerprint === fingerprint && Date.now() - attempt.createdAt < 15 * 60 * 1000) return attempt.key;
    }
    const key = crypto.randomUUID();
    sessionStorage.setItem('checkout-attempt', JSON.stringify({ fingerprint, key, createdAt: Date.now() }));
    return key;
  }

  /**
   * Dynamically loads the official Razorpay Checkout JavaScript SDK
   */
  loadRazorpayScript(): Promise<boolean> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') return resolve(false);
      if ((window as any).Razorpay) return resolve(true);

      const existingScript = document.getElementById('razorpay-checkout-js');
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(true));
        existingScript.addEventListener('error', () => resolve(false));
        return;
      }

      const script = document.createElement('script');
      script.id = 'razorpay-checkout-js';
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => {
        script.remove();
        resolve(false);
      };
      document.body.appendChild(script);
    });
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
        tap((receipt) => {
          this.lastReceipt.set(receipt);
          sessionStorage.removeItem('checkout-attempt');
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
        tap((receipt) => {
          this.lastReceipt.set(receipt);
          sessionStorage.removeItem('checkout-attempt');
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


    const options: any = {
      key: orderData.keyId,
      order_id: orderData.razorpayOrderId,
      amount: orderData.amount,
      currency: orderData.currency || 'INR',
      name: 'Urban Blade Luxury Salon',
      description: `Order #${orderData.orderId.slice(0, 8).toUpperCase()}`,
      image: 'https://cdn-icons-png.flaticon.com/512/3663/3663335.png',
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
          if (callbacks.onDismiss) callbacks.onDismiss();
        },
      },
      handler: (response: any) => {
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
        if (callbacks.onError) callbacks.onError(errResp?.error);
      });
      rzp.open();
    } catch (err) {
      if (callbacks.onError) callbacks.onError(err);
    }
  }

  /**
   * Phase 1: Real-time Two-Phase Checkout Session with Atomic Neon DB Inventory Lock
   */
  createCheckoutSession(payload: {
    items: CheckoutItemRequest[];
    shippingAddress: ShippingAddress;
    paymentMethod?: 'upi' | 'card' | 'cash_on_delivery';
    userId?: string;
  }): Observable<CheckoutSessionResponse> {
    this.isProcessing.set(true);

    return this.http
      .post<CheckoutSessionResponse>(`${API_BASE}/orders/checkout-session`, payload)
      .pipe(
        tap(() => this.isProcessing.set(false)),
        catchError((err) => {
          this.isProcessing.set(false);
          return throwError(() => err);
        })
      );
  }

  cancelPayment(orderId: string, reason?: string): Observable<any> {
    return this.http
      .post(`${API_BASE}/orders/cancel-payment`, { orderId, reason })
      ;
  }

  verifyPayment(payload: {
    orderId: string;
    paymentId: string;
    signatureToken?: string;
    expiresAt?: number;
    paymentDetails?: any;
  }): Observable<PaymentReceipt> {
    this.isProcessing.set(true);

    return this.http
      .post<PaymentReceipt>(`${API_BASE}/orders/verify-payment`, payload)
      .pipe(
        tap((receipt) => {
          this.lastReceipt.set(receipt);
          sessionStorage.removeItem('checkout-attempt');
          this.isProcessing.set(false);
        }),
        catchError((err) => {
          this.isProcessing.set(false);
          return throwError(() => err);
        })
      );
  }
}
