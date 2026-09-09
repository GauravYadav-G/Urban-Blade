import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService, type Toast } from '@core/services/toast.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toast-container.html',
  styleUrl: './toast-container.scss',
})
export class ToastContainer {
  readonly toastService = inject(ToastService);
  readonly toasts = this.toastService.toasts;

  dismiss(t: Toast): void {
    this.toastService.dismiss(t.id);
  }
}
