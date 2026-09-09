import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  durationMs: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);

  show(message: string, type: 'success' | 'error' | 'info' = 'success', durationMs = 3500): void {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newToast: Toast = { id, message, type, durationMs };

    this.toasts.update((current) => [...current, newToast]);

    if (durationMs > 0) {
      setTimeout(() => {
        this.dismiss(id);
      }, durationMs);
    }
  }

  success(message: string, durationMs = 3500): void {
    this.show(message, 'success', durationMs);
  }

  error(message: string, durationMs = 4500): void {
    this.show(message, 'error', durationMs);
  }

  info(message: string, durationMs = 3500): void {
    this.show(message, 'info', durationMs);
  }

  dismiss(id: string): void {
    this.toasts.update((current) => current.filter((t) => t.id !== id));
  }
}
