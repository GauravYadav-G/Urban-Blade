import { Component, EventEmitter, Input, Output, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InrPipe } from '@shared/pipes/inr-pipe';
import { PaymentService, CheckoutSessionResponse, PaymentReceipt } from '@core/services/payment.service';
import { ToastService } from '@core/services/toast.service';

@Component({
  selector: 'app-payment-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, InrPipe],
  templateUrl: './payment-modal.html',
  styleUrl: './payment-modal.scss',
})
export class PaymentModal implements OnInit, OnDestroy {
  @Input({ required: true }) session!: CheckoutSessionResponse;
  @Output() paymentSuccess = new EventEmitter<PaymentReceipt>();
  @Output() paymentCancelled = new EventEmitter<void>();

  private readonly paymentService = inject(PaymentService);
  private readonly toast = inject(ToastService);

  readonly activeTab = signal<'upi' | 'card' | 'cod'>('upi');
  readonly isVerifying = signal(false);
  readonly verificationStep = signal<string>('');
  readonly errorMessage = signal<string>('');

  // UPI State
  readonly upiVpa = signal('gaurav@okaxis');
  readonly upiTimeRemaining = signal(300); // 5 minutes
  private timerInterval: any;

  // Card State
  readonly cardNumber = signal('');
  readonly cardExpiry = signal('');
  readonly cardCvv = signal('');
  readonly cardHolder = signal('');
  readonly cardBrand = signal<'visa' | 'mastercard' | 'rupay' | 'card'>('card');
  readonly show3dsModal = signal(false);
  readonly otpInput = signal('');
  readonly testOtp = '729401';

  ngOnInit(): void {
    if (this.session.paymentMethod) {
      this.activeTab.set(this.session.paymentMethod === 'cash_on_delivery' ? 'cod' : this.session.paymentMethod);
    }
    this.startTimer();
    this.cardHolder.set(this.session.shippingAddress.fullName);
  }

  ngOnDestroy(): void {
    this.stopTimer();
  }

  setTab(tab: 'upi' | 'card' | 'cod'): void {
    if (this.isVerifying()) return;
    this.activeTab.set(tab);
    this.errorMessage.set('');
  }

  private startTimer(): void {
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      this.upiTimeRemaining.update((time) => {
        if (time <= 1) {
          this.stopTimer();
          this.errorMessage.set('Payment session expired. Please re-initiate checkout.');
          return 0;
        }
        return time - 1;
      });
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  get formattedTimer(): string {
    const mins = Math.floor(this.upiTimeRemaining() / 60);
    const secs = this.upiTimeRemaining() % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  // ─── CARD FORMATTERS & BRAND DETECTOR ──────────────────────────────────────
  onCardNumberInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = input.value.replace(/\D/g, '').slice(0, 16);
    const formatted = raw.match(/.{1,4}/g)?.join(' ') || raw;
    this.cardNumber.set(formatted);

    // Detect card brand
    if (raw.startsWith('4')) {
      this.cardBrand.set('visa');
    } else if (/^5[1-5]/.test(raw)) {
      this.cardBrand.set('mastercard');
    } else if (/^(508|60|65)/.test(raw)) {
      this.cardBrand.set('rupay');
    } else {
      this.cardBrand.set('card');
    }
  }

  onExpiryInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    let raw = input.value.replace(/\D/g, '').slice(0, 4);
    if (raw.length >= 3) {
      raw = `${raw.slice(0, 2)}/${raw.slice(2)}`;
    }
    this.cardExpiry.set(raw);
  }

  onCvvInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.cardCvv.set(input.value.replace(/\D/g, '').slice(0, 4));
  }

  // ─── PAYMENT AUTHORIZATION FLOWS ──────────────────────────────────────────

  /**
   * UPI Flow
   */
  processUpiPayment(): void {
    if (!this.upiVpa().includes('@')) {
      this.errorMessage.set('Please enter a valid UPI ID (e.g. name@okaxis)');
      return;
    }

    this.isVerifying.set(true);
    this.errorMessage.set('');
    this.verificationStep.set('1/3: Dispatching UPI collect request...');

    setTimeout(() => {
      this.verificationStep.set('2/3: Authorizing with banking network...');
      setTimeout(() => {
        this.verificationStep.set('3/3: Validating cryptographic HMAC signature in Neon DB...');
        const paymentId = `pay_upi_${Date.now()}`;
        this.executeVerification(paymentId, { upiVpa: this.upiVpa(), method: 'UPI' });
      }, 700);
    }, 800);
  }

  /**
   * Card Flow with 3DS OTP
   */
  initiateCardPayment(): void {
    const rawDigits = this.cardNumber().replace(/\s/g, '');
    if (rawDigits.length < 15) {
      this.errorMessage.set('Please enter a valid 16-digit card number.');
      return;
    }
    if (this.cardExpiry().length < 5) {
      this.errorMessage.set('Please enter valid MM/YY expiry date.');
      return;
    }
    if (this.cardCvv().length < 3) {
      this.errorMessage.set('Please enter 3-digit CVV.');
      return;
    }

    this.errorMessage.set('');
    this.show3dsModal.set(true);
    this.otpInput.set(this.testOtp); // Auto-populate for seamless pair testing
  }

  submit3dsOtp(): void {
    if (this.otpInput() !== this.testOtp) {
      this.errorMessage.set('Invalid OTP. Please enter the test code shown.');
      return;
    }

    this.show3dsModal.set(false);
    this.isVerifying.set(true);
    this.verificationStep.set('1/2: Processing 3D Secure bank authorization...');

    setTimeout(() => {
      this.verificationStep.set('2/2: Confirming payment capture in Neon PostgreSQL...');
      const paymentId = `pay_card_${Date.now()}`;
      const rawDigits = this.cardNumber().replace(/\s/g, '');
      this.executeVerification(paymentId, {
        cardLast4: rawDigits.slice(-4),
        network: this.cardBrand().toUpperCase(),
        method: 'Card',
      });
    }, 900);
  }

  /**
   * Cash on Delivery Flow
   */
  processCodPayment(): void {
    this.isVerifying.set(true);
    this.verificationStep.set('Generating verified cash on delivery dispatch order in Neon DB...');

    setTimeout(() => {
      const paymentId = `pay_cod_${Date.now()}`;
      this.executeVerification(paymentId, { method: 'Cash on Delivery' });
    }, 700);
  }

  private executeVerification(paymentId: string, details: any): void {
    this.paymentService
      .verifyPayment({
        orderId: this.session.orderId,
        paymentId,
        signatureToken: this.session.signatureToken,
        expiresAt: this.session.expiresAt,
        paymentDetails: details,
      })
      .subscribe({
        next: (receipt) => {
          this.isVerifying.set(false);
          this.toast.success(`🎉 Payment Verified! Order #${receipt.receiptNumber} confirmed in Neon DB.`);
          this.paymentSuccess.emit(receipt);
        },
        error: (err) => {
          this.isVerifying.set(false);
          const msg = err.error?.message || 'Payment verification failed. Please try again.';
          this.errorMessage.set(msg);
          this.toast.error(msg);
        },
      });
  }

  cancelCheckout(): void {
    if (this.isVerifying()) return;
    this.paymentService.cancelPayment(this.session.orderId, 'User cancelled payment modal').subscribe({
      next: () => {
        this.toast.info('Checkout cancelled. Reserved stock released back to inventory.');
        this.paymentCancelled.emit();
      },
      error: () => {
        this.paymentCancelled.emit();
      },
    });
  }
}
