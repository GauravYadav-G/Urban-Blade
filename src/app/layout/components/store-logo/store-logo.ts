import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ThemeService } from '@core/services/theme.service';

@Component({
  selector: 'app-store-logo',
  imports: [RouterLink],
  template: `
    <a routerLink="/" class="store-logo" aria-label="Urban Blade home">
      @if (theme.theme() === 'dark') {
        <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 40 40" aria-hidden="true">
          <rect width="40" height="40" rx="8" fill="#2a2118" stroke="#ff9800" stroke-width="1.6" />
          <path
            d="M9 24.5 23.2 10.3a2.2 2.2 0 013.1 0l3.4 3.4a2.2 2.2 0 010 3.1L15.5 31.3a2 2 0 01-1.5.6H9.8a1.2 1.2 0 01-1.2-1.4l.4-6z"
            fill="#ff9800"
          />
          <path d="M24.4 11.6 28.4 15.6" stroke="#fff3e0" stroke-width="1.4" stroke-linecap="round" />
          <path d="M11 26.2h6.2" stroke="#2a2118" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      } @else {
        <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 40 40" aria-hidden="true">
          <rect width="40" height="40" rx="8" fill="#ff9800" />
          <path
            d="M12 14h16l-1.4 12.2A3 3 0 0123.6 29H16.4a3 3 0 01-3-2.8L12 14zm4-3.5A4 4 0 0120 7a4 4 0 014 3.5"
            fill="none"
            stroke="#fff"
            stroke-width="2.2"
            stroke-linecap="round"
          />
        </svg>
      }
      @if (showWordmark()) {
        <span>Urban <strong>Blade</strong></span>
      }
    </a>
  `,
  styles: `
    :host {
      display: inline-flex;
      min-width: 0;
    }

    .store-logo {
      display: inline-flex;
      align-items: center;
      gap: 0.55rem;
      min-width: 0;
      color: var(--brand);
      text-decoration: none;
      font-size: inherit;
      letter-spacing: -0.03em;

      span {
        white-space: nowrap;
      }

      strong {
        font-weight: 800;
      }
    }
  `,
})
export class StoreLogo {
  protected readonly theme = inject(ThemeService);
  readonly size = input(36);
  readonly showWordmark = input(true);
}
