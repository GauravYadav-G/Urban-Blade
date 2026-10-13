import { ChangeDetectionStrategy, Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AdminService } from '@core/services/admin.service';
import { ToastService } from '@core/services/toast.service';
import type { VendorAccount } from '@core/models/vendor.model';

type Readiness = 'verified' | 'review' | 'missing';

@Component({
  selector: 'app-admin-vendors', standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink],
  templateUrl: './admin-vendors.html', styleUrl: './admin-vendors.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminVendors implements OnInit {
  readonly admin = inject(AdminService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  @ViewChild('editor') private editor!: ElementRef<HTMLDialogElement>;
  @ViewChild('verification') private verification!: ElementRef<HTMLDialogElement>;
  readonly search = signal('');
  readonly status = signal('all');
  readonly readinessFilter = signal('all');
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly saving = signal(false);
  readonly formError = signal('');
  readonly editing = signal<VendorAccount | null>(null);
  readonly reviewing = signal<VendorAccount | null>(null);
  readonly verificationError = signal('');
  readonly verificationComplete = signal(false);
  readonly confirmed = signal(false);
  readonly filterOptions = [
    { value: 'all', label: 'All vendors' }, { value: 'attention', label: 'Needs attention' },
    { value: 'verified', label: 'Verified' }, { value: 'missing', label: 'Missing details' },
  ];
  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(150)]],
    email: ['', [Validators.required, Validators.email]],
    password: [''],
    contact_person: ['', [Validators.required, Validators.minLength(2)]],
    phone: ['', [Validators.required, Validators.pattern(/^(?:\+91[ -]?)?[6-9]\d{9}$/)]],
    commission_rate: [12, [Validators.required, Validators.min(0), Validators.max(100)]],
    status: ['active', Validators.required],
    bank: [''], accountNo: [''], ifsc: ['', Validators.pattern(/^$|^[A-Za-z]{4}0[A-Za-z0-9]{6}$/)],
    upi: ['', Validators.pattern(/^$|^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/)],
  });
  readonly vendors = computed(() => this.admin.vendors() || []);
  readonly activeCount = computed(() => this.vendors().filter(v => v.status === 'active').length);
  readonly verifiedCount = computed(() => this.vendors().filter(v => this.readiness(v) === 'verified').length);
  readonly attentionCount = computed(() => this.vendors().length - this.verifiedCount());
  readonly filtered = computed(() => {
    const query = this.search().trim().toLowerCase();
    return this.vendors().filter(v =>
      (!query || [v.name, v.email, v.contact_person, v.phone].some(value => (value || '').toLowerCase().includes(query))) &&
      (this.status() === 'all' || v.status === this.status()) &&
      (this.readinessFilter() === 'all' || (this.readinessFilter() === 'attention' ? this.readiness(v) !== 'verified' : this.readiness(v) === this.readinessFilter()))
    );
  });
  ngOnInit(): void { void this.refresh(); }
  async refresh(): Promise<void> {
    this.loading.set(true); this.loadError.set('');
    try { await firstValueFrom(this.admin.loadVendorDirectory()); }
    catch { this.loadError.set('Vendor records could not be refreshed. Retry before making changes.'); }
    finally { this.loading.set(false); }
  }
  readiness(vendor: VendorAccount): Readiness {
    const account = vendor.payout_account;
    if (!account?.upi && !(account?.accountNo && account?.ifsc)) return 'missing';
    return account?.verified && account.verificationReference && account.verifiedAt ? 'verified' : 'review';
  }
  readinessLabel(vendor: VendorAccount): string {
    return { verified: 'Verified', review: 'Needs verification', missing: 'Missing details' }[this.readiness(vendor)];
  }
  destination(vendor: VendorAccount): string {
    const account = vendor.payout_account;
    return account?.upi || (account?.accountNo ? `Account ending ${account.accountNo.slice(-4)}` : 'No account saved');
  }
  clearFilters(): void { this.search.set(''); this.status.set('all'); this.readinessFilter.set('all'); }
  openEditor(vendor: VendorAccount | null = null): void {
    this.editing.set(vendor); this.formError.set('');
    const account = vendor?.payout_account;
    this.form.reset({ name: vendor?.name || '', email: vendor?.email || '', password: '',
      contact_person: vendor?.contact_person || '', phone: vendor?.phone || '',
      commission_rate: Number(vendor?.commission_rate ?? 12), status: vendor?.status || 'active',
      bank: account?.bank || '', accountNo: account?.accountNo || '', ifsc: account?.ifsc || '', upi: account?.upi || '' });
    this.form.controls.password.setValidators(vendor ? [] : [Validators.required, Validators.minLength(10), Validators.maxLength(72)]);
    this.form.controls.password.updateValueAndValidity();
    this.editor.nativeElement.showModal();
  }
  closeEditor(): void { if (!this.saving()) this.editor.nativeElement.close(); }
  async save(): Promise<void> {
    if (this.saving()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) { this.formError.set('Check the highlighted fields before saving.'); return; }
    const value = this.form.getRawValue();
    if ((value.accountNo || value.ifsc) && !(value.accountNo && value.ifsc)) {
      this.formError.set('Provide both the bank account number and IFSC, or leave both blank.'); return;
    }
    this.saving.set(true); this.formError.set('');
    const vendor = this.editing();
    try {
      await firstValueFrom(this.admin.saveVendorProfile(vendor?.id || null, {
        name: value.name.trim(), email: value.email.trim().toLowerCase(),
        ...(!vendor ? { password: value.password } : {}),
        contact_person: value.contact_person.trim(), phone: value.phone.replace(/^\+91[ -]?/, ''),
        commission_rate: Number(value.commission_rate), status: value.status as VendorAccount['status'],
        payout_account: { bank: value.bank.trim(), accountNo: value.accountNo.trim(),
          ifsc: value.ifsc.trim().toUpperCase(), upi: value.upi.trim().toLowerCase() },
      }));
      this.editor.nativeElement.close();
      this.toast.success(vendor ? 'Vendor details saved.' : 'Vendor account created. Review payout details next.');
    } catch (error) { this.formError.set(this.message(error, 'Changes were not saved. Please retry.')); }
    finally { this.saving.set(false); }
  }
  openVerification(vendor: VendorAccount): void {
    this.reviewing.set(vendor); this.confirmed.set(false);
    this.verificationError.set(''); this.verificationComplete.set(false);
    this.verification.nativeElement.showModal();
  }
  closeVerification(): void { if (!this.saving()) this.verification.nativeElement.close(); }
  editDestination(): void {
    const vendor = this.reviewing();
    this.closeVerification(); if (vendor) this.openEditor(vendor);
  }
  async verify(verified = true): Promise<void> {
    const vendor = this.reviewing();
    if (!vendor || this.saving() || (verified && (!this.confirmed() || !vendor.payout_account?.upi))) return;
    this.saving.set(true); this.verificationError.set('');
    try {
      const result = await firstValueFrom(this.admin.verifyVendorPayout(vendor.id, verified));
      if (!result.vendor) throw new Error('No account returned');
      this.reviewing.set(result.vendor); this.verificationComplete.set(verified); this.confirmed.set(false);
    } catch (error) { this.verificationError.set(this.message(error, 'Verification could not be completed. No verification was recorded.')); }
    finally { this.saving.set(false); }
  }
  private message(error: unknown, fallback: string): string {
    return (error as { error?: { message?: string } })?.error?.message || fallback;
  }
}
