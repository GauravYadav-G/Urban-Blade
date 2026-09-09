import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CartService } from '@core/services/cart.service';
import { ImgFallback } from '@shared/directives/img-fallback';
import { InrPipe } from '@shared/pipes/inr-pipe';

@Component({
  selector: 'app-cart-toast',
  imports: [RouterLink, InrPipe, ImgFallback],
  templateUrl: './cart-toast.html',
  styleUrl: './cart-toast.scss',
})
export class CartToast {
  protected readonly cart = inject(CartService);
}
