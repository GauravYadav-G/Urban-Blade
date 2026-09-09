import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SALON } from '@core/constants/salon.constants';

@Component({
  selector: 'app-sell-page',
  imports: [RouterLink],
  templateUrl: './sell-page.html',
  styleUrl: './sell-page.scss',
})
export class SellPage {
  readonly salon = SALON;
}
