import { AccountService } from '@core/services/account.service';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CatalogService } from '@core/services/catalog.service';
import { AdminService, type AdminBooking } from '@core/services/admin.service';
import { SiteSettingsService } from '@core/services/site-settings.service';
import { SALON } from '@core/constants/salon.constants';

@Component({
  selector: 'app-book-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './book-page.html',
  styleUrl: './book-page.scss',
})
export class BookPage {
  private readonly fb = inject(FormBuilder);
  private readonly catalog = inject(CatalogService);
  private readonly admin = inject(AdminService);
  private readonly route = inject(ActivatedRoute);
  readonly siteSettings = inject(SiteSettingsService);

  private readonly account=inject(AccountService);
  readonly saving=signal(false);
  readonly error=signal('');
  readonly minDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  readonly salon = SALON;
  readonly settings = this.siteSettings.settings;
  readonly services = computed(() => this.catalog.byCategory('services'));
  private readonly requestedService = toSignal(
    this.route.queryParamMap.pipe(map(params => params.get('service') ?? '')),
    { initialValue: this.route.snapshot.queryParamMap.get('service') ?? '' },
  );
  private appliedService = '';
  submitted = false;
  lastBooking: AdminBooking | null = null;

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    phone: ['', [Validators.required, Validators.minLength(10)]],
    service: [this.catalog.byCategory('services')[0]?.name ?? '', Validators.required],
    date: ['', Validators.required],
    time: ['', Validators.required],
    visitType: ['salon' as 'salon' | 'home', Validators.required],
    address: [''],
  });

  constructor() {
    effect(() => {
      const requested = this.requestedService();
      const service = this.services().find(item => item.id === requested || item.slug === requested);
      if (service && this.appliedService !== requested) {
        this.form.controls.service.setValue(service.name);
        this.appliedService = requested;
      }
    });
  }

  submit(): void {
    if(this.saving())return;
    this.error.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const val = this.form.getRawValue();
    if(val.date < this.minDate){this.form.controls.date.setErrors({past:true});return;}
    if (val.visitType === 'home' && val.address.trim().length < 8) {
      this.form.controls.address.setErrors({ required: true });
      this.form.controls.address.markAsTouched();
      return;
    }
    const serviceMatch = this.services().find((s: any) => s.name === val.service);
    if (!serviceMatch) {
      this.form.controls.service.setErrors({ unavailable: true });
      return;
    }

    const booking: AdminBooking = {
      id: `bk-ub-${Date.now().toString().slice(-5)}`,
      customer_name: val.name,
      customer_email: this.account.user()?.email || '',
      customer_phone: val.phone,
      booking_date: val.date,
      time_slot: val.time,
      visit_type: val.visitType,
      service_address: val.visitType === 'home' ? val.address.trim() : null,
      status: 'confirmed',
      total_price: serviceMatch.price,
      notes: val.service,
    };

    this.saving.set(true);
    this.admin.addBooking(booking, 'customer').subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.lastBooking = { ...booking, ...saved };
        this.submitted = true;
      },
      error: err => {this.saving.set(false);this.error.set(err.error?.message || 'Your booking was not saved. Please retry.');},
    });
  }

  reset(): void {
    this.submitted = false;
    this.lastBooking = null;
    this.form.reset({
      name: '',
      phone: '',
      service: this.services()[0]?.name ?? '',
      date: '',
      time: '',
      visitType: 'salon',
      address: '',
    });
  }
}
