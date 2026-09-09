import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SALON } from '@core/constants/salon.constants';

@Component({
  selector: 'app-terms-page',
  imports: [RouterLink],
  templateUrl: './terms-page.html',
  styleUrl: '../legal-page/legal-page.scss',
})
export class TermsPage {
  readonly salon = SALON;
}
