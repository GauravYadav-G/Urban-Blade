import { Component, inject } from '@angular/core';
import { ThemeService } from '@core/services/theme.service';

@Component({
  selector: 'app-theme-toggle',
  template: `
    <button
      type="button"
      class="theme-toggle"
      (click)="theme.toggle()"
      [attr.aria-label]="theme.theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
      [attr.title]="theme.theme() === 'dark' ? 'Light theme' : 'Dark theme'"
    >
      @if (theme.theme() === 'dark') {
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8" />
          <path
            d="M12 3v1.6M12 19.4V21M4.2 4.2l1.1 1.1M18.7 18.7l1.1 1.1M3 12h1.6M19.4 12H21M4.2 19.8l1.1-1.1M18.7 5.3l1.1-1.1"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
      } @else {
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M15.2 3.2A8.8 8.8 0 1012 21.5 7.2 7.2 0 0015.2 3.2z"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linejoin="round"
          />
        </svg>
      }
    </button>
  `,
  styles: `
    .theme-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.65rem;
      height: 2.65rem;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: 50%;
      background: var(--surface);
      color: var(--ink);
      cursor: pointer;
    }

    .theme-toggle:hover {
      color: var(--brand);
      border-color: var(--brand);
    }
  `,
})
export class ThemeToggle {
  protected readonly theme = inject(ThemeService);
}
