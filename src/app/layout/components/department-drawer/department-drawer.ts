import { Component, effect, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DEPARTMENT_SECTIONS } from '@core/constants/navigation.constants';
import { AccountService } from '@core/services/account.service';
import { CartService } from '@core/services/cart.service';

@Component({
  selector: 'app-department-drawer',
  imports: [RouterLink],
  templateUrl: './department-drawer.html',
  styleUrl: './department-drawer.scss',
})
export class DepartmentDrawer {
  private readonly account = inject(AccountService);
  private readonly cart = inject(CartService);

  readonly open = input(false);
  readonly closed = output<void>();
  readonly sections = DEPARTMENT_SECTIONS;
  readonly itemCount = this.cart.itemCount;
  readonly isSignedIn = this.account.isSignedIn;

  constructor() {
    effect(() => {
      document.body.classList.toggle('drawer-open', this.open());
    });
  }

  requestClose(): void {
    this.closed.emit();
  }
}
