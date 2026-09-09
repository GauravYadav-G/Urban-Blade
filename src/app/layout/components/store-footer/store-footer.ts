import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteSettingsService } from '@core/services/site-settings.service';
import { StoreLogo } from '../store-logo/store-logo';

@Component({
  selector: 'app-store-footer',
  imports: [RouterLink, StoreLogo],
  templateUrl: './store-footer.html',
  styleUrl: './store-footer.scss',
})
export class StoreFooter {
  private readonly siteSettings = inject(SiteSettingsService);
  readonly settings = this.siteSettings.settings;
  readonly year = new Date().getFullYear();

  readonly columns: {
    title: string;
    links: { label: string; route: string; query?: Record<string, string> }[];
  }[] = [
    {
      title: 'Your Urban Blade',
      links: [
        { label: 'Your account', route: '/account' },
        { label: 'Your list', route: '/lists' },
        { label: 'Your recently viewed items', route: '/recent' },
      ],
    },
    {
      title: 'Help',
      links: [
        { label: 'Help', route: '/help' },
        { label: 'Customer service', route: '/support' },
        { label: 'Terms and conditions', route: '/terms' },
        { label: 'Privacy policy', route: '/privacy' },
      ],
    },
    {
      title: 'Sell',
      links: [{ label: 'Sell on Urban Blade', route: '/sell' }],
    },
  ];

  scrollToTop(event: Event): void {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
