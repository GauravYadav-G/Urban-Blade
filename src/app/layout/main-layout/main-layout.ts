import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CartToast } from '../components/cart-toast/cart-toast';
import { StoreFooter } from '../components/store-footer/store-footer';
import { StoreHeader } from '../components/store-header/store-header';

@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, StoreHeader, StoreFooter, CartToast],
  template: `
    <div class="shell" id="top">
      <app-store-header />
      <main class="shell__main">
        <router-outlet />
      </main>
      <app-store-footer />
      <app-cart-toast />
    </div>
  `,
  styles: `
    .shell {
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      width: 100%;
    }
    .shell__main {
      flex: 1;
      width: 100%;
      max-width: none;
      padding: 0;
    }
  `,
})
export class MainLayout {}
