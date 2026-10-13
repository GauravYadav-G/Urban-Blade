import { Component, computed, effect, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AccountService } from '@core/services/account.service';
import { AddressService } from '@core/services/address.service';
import { CatalogService } from '@core/services/catalog.service';
import { AdminService, type AdminBooking } from '@core/services/admin.service';
import { SiteSettingsService } from '@core/services/site-settings.service';
import { formatFullAddress, type SavedAddress } from '@core/models/address.model';
import { InrPipe } from '@shared/pipes/inr-pipe';

@Component({
  selector: 'app-book-page', standalone: true,
  imports: [ReactiveFormsModule, RouterLink, DatePipe, InrPipe],
  templateUrl: './book-page.html', styleUrl: './book-page.scss',
})
export class BookPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  readonly catalog = inject(CatalogService);
  private readonly admin = inject(AdminService);
  private readonly route = inject(ActivatedRoute);
  readonly account = inject(AccountService);
  readonly addresses = inject(AddressService);
  readonly settings = inject(SiteSettingsService).settings;
  readonly saving = signal(false);
  readonly error = signal('');
  readonly minDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  readonly services = computed(() => this.catalog.byCategory('services').filter(service => service.inStock));
  private readonly requestedService = toSignal(
    this.route.queryParamMap.pipe(map(params => params.get('service') ?? '')),
    { initialValue: this.route.snapshot.queryParamMap.get('service') ?? '' },
  );
  private appliedService = '';
  submitted = false;
  lastBooking: AdminBooking | null = null;

  readonly form = this.fb.nonNullable.group({
    name: [this.account.user()?.name ?? '', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    phone: [(this.account.user()?.phone ?? '').replace(/\D/g, '').slice(-10), [Validators.required, Validators.pattern(/^[6-9]\d{9}$/)]],
    service: [this.services()[0]?.id ?? '', Validators.required],
    date: ['', Validators.required], time: ['', Validators.required],
    visitType: ['salon' as 'salon' | 'home', Validators.required],
    address: ['', Validators.maxLength(500)],
  });
  readonly details = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  readonly selectedService = computed(() => this.services().find(service => service.id === this.details().service));

  constructor() {
    effect(() => {
      const requested = this.requestedService();
      const services = this.services();
      const service = services.find(item => item.id === requested || item.slug === requested);
      if (service && this.appliedService !== requested) {
        this.form.controls.service.setValue(service.id);
        this.appliedService = requested;
      } else if (!this.form.controls.service.value && services.length) {
        this.form.controls.service.setValue(services[0].id);
      }
    });
    effect(() => {
      const user = this.account.user();
      const address = this.addresses.addresses().find(item => item.isDefault);
      if (user && !this.form.controls.name.value) this.form.controls.name.setValue(user.name);
      if (!this.form.controls.phone.value) {
        const phone = user?.phone || address?.mobile;
        if (phone) this.form.controls.phone.setValue(phone.replace(/\D/g, '').slice(-10));
      }
      if (address && !this.form.controls.address.value && !this.form.controls.address.dirty) {
        this.form.controls.address.setValue(formatFullAddress(address));
      }
    });
  }

  async ngOnInit(): Promise<void> { await this.addresses.load(true); }
  useAddress(address: SavedAddress): void { this.form.controls.address.setValue(formatFullAddress(address)); }

  submit(): void {
    if (this.saving()) return;
    this.error.set('');
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const val = this.form.getRawValue();
    if (val.name.trim().length < 2) { this.form.controls.name.setErrors({ required: true }); return; }
    if (val.date < this.minDate) { this.form.controls.date.setErrors({ past: true }); return; }
    const currentTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    if (val.date === this.minDate && val.time <= currentTime) {
      this.form.controls.time.setErrors({ past: true }); return;
    }
    if (val.visitType === 'home' && val.address.trim().length < 8) {
      this.form.controls.address.setErrors({ required: true }); return;
    }
    const service = this.services().find(item => item.id === val.service);
    if (!service) { this.form.controls.service.setErrors({ unavailable: true }); return; }
    const booking: AdminBooking = {
      id: crypto.randomUUID(), service_id: service.id,
      customer_name: val.name.trim(), customer_email: this.account.user()?.email || '',
      customer_phone: val.phone, booking_date: val.date, time_slot: val.time,
      visit_type: val.visitType, service_address: val.visitType === 'home' ? val.address.trim() : null,
      status: 'confirmed', total_price: service.price, notes: service.name,
    };
    this.saving.set(true);
    this.admin.addBooking(booking, 'customer').subscribe({
      next: saved => {
        this.saving.set(false); this.lastBooking = { ...booking, ...saved }; this.submitted = true;
      },
      error: (error: { error?: { message?: string } }) => {
        this.saving.set(false); this.error.set(error.error?.message || 'Your booking was not saved. Please retry.');
      },
    });
  }

  reset(): void {
    this.submitted = false; this.lastBooking = null; this.error.set('');
    const address = this.addresses.addresses().find(item => item.isDefault);
    this.form.reset({
      name: this.account.user()?.name ?? '', phone: (this.account.user()?.phone || address?.mobile || '').replace(/\D/g, '').slice(-10),
      service: this.services()[0]?.id ?? '', date: '', time: '', visitType: 'salon',
      address: address ? formatFullAddress(address) : '',
    });
  }
}
