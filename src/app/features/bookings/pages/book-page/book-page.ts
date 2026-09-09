import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CatalogService } from '@core/services/catalog.service';
import { AdminService, type AdminBooking } from '@core/services/admin.service';
import { SiteSettingsService } from '@core/services/site-settings.service';
import { SALON } from '@core/constants/salon.constants';

@Component({
  selector: 'app-book-page',
  imports: [ReactiveFormsModule],
  templateUrl: './book-page.html',
  styleUrl: './book-page.scss',
})
export class BookPage {
  private readonly fb = inject(FormBuilder);
  private readonly catalog = inject(CatalogService);
  private readonly admin = inject(AdminService);
  readonly siteSettings = inject(SiteSettingsService);

  readonly salon = SALON;
  readonly settings = this.siteSettings.settings;
  readonly services = this.catalog.byCategory('services');
  submitted = false;

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    phone: ['', [Validators.required, Validators.minLength(10)]],
    service: [this.catalog.byCategory('services')[0]?.name ?? 'Skin-Fade Haircut & Beard Trim', Validators.required],
    date: ['', Validators.required],
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const val = this.form.getRawValue();
    const serviceMatch = this.services.find((s) => s.name === val.service);

    const booking: AdminBooking = {
      id: `bk-ub-${Date.now().toString().slice(-5)}`,
      customer_name: val.name,
      customer_email: `${val.name.toLowerCase().replace(/\s+/g, '')}@client.in`,
      customer_phone: val.phone,
      stylist_name: 'Vikram Sharma',
      booking_date: val.date,
      time_slot: '11:00 AM',
      status: 'confirmed',
      total_price: serviceMatch?.price || 499,
      notes: val.service,
    };

    this.admin.addBooking(booking);
    this.submitted = true;
  }
}
