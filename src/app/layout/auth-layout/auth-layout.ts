import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { StoreLogo } from '../components/store-logo/store-logo';
import { ThemeToggle } from '../components/theme-toggle/theme-toggle';

@Component({
  selector: 'app-auth-layout',
  imports: [RouterOutlet, StoreLogo, ThemeToggle],
  template: `
    <div class="auth-split">
      <aside class="auth-split__visual" aria-hidden="true">
        <img src="/images/auth/login-salon.png" alt="" />
        <div class="auth-split__overlay">
          <p>Urban Blade salon store</p>
          <h2>Hair serum, beard oil &amp; salon tools</h2>
        </div>
      </aside>
      <main class="auth-split__panel">
        <div class="auth-split__bar">
        <app-store-logo class="auth-split__logo" [size]="32" />
        <app-theme-toggle />
        </div>
        <router-outlet />
      </main>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100dvh;
    }

    .auth-split {
      display: grid;
      grid-template-columns: 1fr;
      min-height: 100dvh;
      background: var(--page);
    }

    .auth-split__visual {
      position: relative;
      min-height: 34vh;
      overflow: hidden;
      background: #1f1f1f;

      img {
        width: 100%;
        height: 100%;
        min-height: 34vh;
        object-fit: cover;
        object-position: center;
      }
    }

    .auth-split__overlay {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 1.4rem 1.5rem 1.6rem;
      background: linear-gradient(180deg, transparent, rgb(0 0 0 / 0.62) 55%);
      color: #fff;

      p {
        margin: 0 0 0.25rem;
        font-size: 0.8rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        opacity: 0.9;
      }

      h2 {
        margin: 0;
        font-size: clamp(1.35rem, 2.4vw, 2.4rem);
        font-weight: 800;
        line-height: 1.2;
        max-width: 18ch;
      }
    }

    .auth-split__panel {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 0;
      padding: 1.5rem 1.25rem 2rem;
    }

    .auth-split__bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 1.4rem;
    }

    .auth-split__logo {
      font-size: 1.35rem;
    }

    @media (min-width: 900px) {
      .auth-split {
        grid-template-columns: minmax(0, 70%) minmax(24rem, 30%);
      }

      .auth-split__visual {
        min-height: 100dvh;

        img {
          min-height: 100dvh;
        }
      }

      .auth-split__overlay {
        padding: 2.5rem 2.75rem 3rem;
      }

      .auth-split__panel {
        padding: 2rem 1.75rem;
      }
    }
  `,
})
export class AuthLayout {}
