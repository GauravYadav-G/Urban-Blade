import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-orders-page',
  imports: [RouterLink],
  template: `
    <h1>Your orders</h1>
    <section class="card">
      <p>No orders yet. After checkout, your salon and retail orders will appear here.</p>
      <a routerLink="/shop">Shop Urban Blade</a>
    </section>
  `,
  styles: `
    h1 { font-weight: 400; }
    .card {
      background: var(--surface);
      padding: 1.5rem;
      border-radius: 8px;
    }
    a { color: var(--link); }
  `,
})
export class OrdersPage {}
