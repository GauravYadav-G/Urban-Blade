import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { Router } from '@angular/router';
import { AccountService } from './account.service';
import { ToastService } from './toast.service';

const SESSION_EXPIRES_KEY = 'urban-blade-admin-session-expiry';
// 15 minutes session inactivity timeout
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
// Show warning when 2 minutes remain
const WARNING_THRESHOLD_SECONDS = 120;

@Injectable({ providedIn: 'root' })
export class AdminSessionService {
  private readonly account = inject(AccountService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  private readonly remainingSecondsSignal = signal<number>(INACTIVITY_TIMEOUT_MS / 1000);
  readonly remainingSeconds = this.remainingSecondsSignal.asReadonly();
  readonly isSessionActive = computed(() => this.account.isAdmin() && this.remainingSeconds() > 0);
  readonly isWarning = computed(() => this.remainingSeconds() > 0 && this.remainingSeconds() <= WARNING_THRESHOLD_SECONDS);

  readonly formattedRemaining = computed(() => {
    const s = Math.max(0, this.remainingSeconds());
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  });

  private timerInterval: any = null;
  private activityHandler: (() => void) | null = null;
  private lastActivityThrottle = 0;
  private hasWarned = false;

  constructor() {
    // If admin is signed in, start tracking
    effect(() => {
      if (this.account.isAdmin()) {
        this.startSessionMonitoring();
      } else {
        this.stopSessionMonitoring();
      }
    });
  }

  /**
   * Initializes or refreshes session expiration timestamp and timers
   */
  startSessionMonitoring(): void {
    if (typeof window === 'undefined') return;

    // Check if an existing expiry is in storage
    const storedExpiry = localStorage.getItem(SESSION_EXPIRES_KEY);
    const now = Date.now();

    if (storedExpiry) {
      const expiry = Number(storedExpiry);
      if (now >= expiry) {
        this.handleSessionExpired();
        return;
      }
      this.remainingSecondsSignal.set(Math.max(0, Math.floor((expiry - now) / 1000)));
    } else {
      this.resetExpiryTimestamp();
    }

    this.attachActivityListeners();
    this.startHeartbeatTimer();
  }

  /**
   * Resets the inactivity timer to full duration
   */
  extendSession(): void {
    this.resetExpiryTimestamp();
    this.hasWarned = false;
    this.toast.success('Admin session extended by 15 minutes.');
  }

  /**
   * Called on user interaction (debounced to avoid performance hit)
   */
  recordActivity(): void {
    const now = Date.now();
    // Throttle to update once every 5 seconds
    if (now - this.lastActivityThrottle < 5000) return;
    this.lastActivityThrottle = now;

    if (this.account.isAdmin()) {
      this.resetExpiryTimestamp();
      this.hasWarned = false;
    }
  }

  /**
   * Checks whether the current admin session is valid and active
   */
  isSessionValid(): boolean {
    if (typeof window === 'undefined') return true;
    const storedExpiry = localStorage.getItem(SESSION_EXPIRES_KEY);
    if (!storedExpiry) return true;
    return Date.now() < Number(storedExpiry);
  }

  private resetExpiryTimestamp(): void {
    if (typeof window === 'undefined') return;
    const expiry = Date.now() + INACTIVITY_TIMEOUT_MS;
    localStorage.setItem(SESSION_EXPIRES_KEY, String(expiry));
    this.remainingSecondsSignal.set(Math.floor(INACTIVITY_TIMEOUT_MS / 1000));
  }

  private startHeartbeatTimer(): void {
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.timerInterval = setInterval(() => {
      if (typeof window === 'undefined') return;
      if (!this.account.isAdmin()) {
        this.stopSessionMonitoring();
        return;
      }

      const storedExpiry = localStorage.getItem(SESSION_EXPIRES_KEY);
      if (!storedExpiry) {
        this.resetExpiryTimestamp();
        return;
      }

      const diffMs = Number(storedExpiry) - Date.now();
      const remainingSec = Math.max(0, Math.floor(diffMs / 1000));
      this.remainingSecondsSignal.set(remainingSec);

      // Warning when nearing expiration
      if (remainingSec <= WARNING_THRESHOLD_SECONDS && remainingSec > 0 && !this.hasWarned) {
        this.hasWarned = true;
        this.toast.warning('⚠️ Admin session expiring in under 2 minutes due to inactivity.');
      }

      // Expired
      if (remainingSec <= 0) {
        this.handleSessionExpired();
      }
    }, 1000);
  }

  private handleSessionExpired(): void {
    this.stopSessionMonitoring();
    localStorage.removeItem(SESSION_EXPIRES_KEY);
    this.account.adminSignOut();
    this.toast.error('🔒 Admin session expired due to inactivity. Please sign in again.');
    void this.router.navigate(['/admin/login'], {
      queryParams: { expired: '1' },
    });
  }

  private attachActivityListeners(): void {
    if (typeof window === 'undefined' || this.activityHandler) return;

    this.activityHandler = () => this.recordActivity();
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((evt) => {
      window.addEventListener(evt, this.activityHandler!, { passive: true });
    });
  }

  private stopSessionMonitoring(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (typeof window !== 'undefined' && this.activityHandler) {
      const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
      events.forEach((evt) => {
        window.removeEventListener(evt, this.activityHandler!);
      });
      this.activityHandler = null;
    }
    if (typeof window !== 'undefined') {
      localStorage.removeItem(SESSION_EXPIRES_KEY);
    }
    this.hasWarned = false;
  }
}
