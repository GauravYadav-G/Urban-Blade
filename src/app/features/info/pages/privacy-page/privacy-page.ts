import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SALON } from '@core/constants/salon.constants';

@Component({
  selector: 'app-privacy-page',
  imports: [RouterLink],
  templateUrl: './privacy-page.html',
  styleUrl: '../legal-page/legal-page.scss',
})
export class PrivacyPage {
  readonly salon = SALON;
}
