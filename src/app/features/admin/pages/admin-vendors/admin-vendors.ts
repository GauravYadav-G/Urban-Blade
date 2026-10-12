import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AdminService } from '@core/services/admin.service';
import { AccountService } from '@core/services/account.service';
import { ToastService } from '@core/services/toast.service';
import type { VendorAccount, VendorPayoutAccount } from '@core/models/vendor.model';

@Component({
  selector: 'app-admin-vendors',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './admin-vendors.html',
  styleUrl: './admin-vendors.scss',
})
export class AdminVendors {
  readonly admin = inject(AdminService);
  readonly account = inject(AccountService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);

  readonly searchQuery = signal<string>('');
  readonly selectedStatusFilter = signal<string>('all');
  readonly isCreateModalOpen = signal<boolean>(false);
  readonly isEditModalOpen = signal<boolean>(false);
  readonly editingVendor = signal<VendorAccount | null>(null);

  // Validation helper for 10-digit Indian mobile numbers (allows +91, 0, spaces, dashes)
  static readonly phoneValidator = (control: any) => {
    if (!control.value) return { required: true };
    const raw = String(control.value).trim().replace(/[\s\-()]/g, '');
    const digits = raw.replace(/^(?:\+91|91|0)(?=[6-9]\d{9}$)/, '');
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return { invalidPhone: true };
    }
    return null;
  };

  // Form for Onboarding Vendor
  readonly createForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(10)]],
    contact_person: ['', [Validators.required, Validators.minLength(2)]],
    phone: ['', [Validators.required, AdminVendors.phoneValidator]],
    commission_rate: [12, [Validators.required, Validators.min(0), Validators.max(50)]],
    bank_name: [''],
    account_no: [''],
    ifsc: [''],
    upi: [''],
  });

  // Form for Editing Vendor
  readonly editForm = this.fb.nonNullable.group({
    contact_person: ['', [Validators.required, Validators.minLength(2)]],
    phone: ['', [Validators.required, AdminVendors.phoneValidator]],
    commission_rate: [12, [Validators.required, Validators.min(0), Validators.max(50)]],
    status: ['active', Validators.required],
    bank_name: [''],
    account_no: [''],
    ifsc: [''],
    upi: [''],
  });

  // Filtered Vendor List
  readonly filteredVendors = computed(() => {
    const list = this.admin.vendors();
    const query = this.searchQuery().toLowerCase().trim();
    const status = this.selectedStatusFilter();

    return list.filter((v) => {
      const matchSearch =
        !query ||
        v.name.toLowerCase().includes(query) ||
        v.email.toLowerCase().includes(query) ||
        v.contact_person.toLowerCase().includes(query) ||
        v.phone.includes(query);
      const matchStatus = status === 'all' || v.status === status;
      return matchSearch && matchStatus;
    });
  });

  // Aggregated KPIs
  readonly totalSales = computed(() =>
    this.admin.vendors().reduce((sum, v) => sum + (v.total_sales || 0), 0)
  );

  readonly totalCommission = computed(() =>
    this.admin.vendors().reduce(
      (sum, v) => sum + (v.total_sales || 0) * ((v.commission_rate ?? 0) / 100),
      0
    )
  );

  readonly activeVendorCount = computed(
    () => this.admin.vendors().filter((v) => v.status === 'active').length
  );

  readonly totalVendorProducts = computed(() =>
    this.admin.vendors().reduce((sum, v) => sum + (v.product_count || 0), 0)
  );

  openCreateModal(): void {
    this.createForm.reset({
      name: '',
      email: '',
      password: '',
      contact_person: '',
      phone: '',
      commission_rate: 12,
      bank_name: '',
      account_no: '',
      ifsc: '',
      upi: '',
    });
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  submitCreateVendor(): void {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      const invalidFields: string[] = [];
      const c = this.createForm.controls;
      if (c.name.invalid) invalidFields.push('Business Name (min 2 characters)');
      if (c.email.invalid) invalidFields.push('Valid Email Address');
      if (c.password.invalid) invalidFields.push('Password (min 10 characters)');
      if (c.contact_person.invalid) invalidFields.push('Representative Contact Person');
      if (c.phone.invalid) invalidFields.push('10-digit Phone Number');
      if (c.commission_rate.invalid) invalidFields.push('Commission Rate (0-50%)');
      
      this.toast.error(
        invalidFields.length
          ? `Please check: ${invalidFields.join(', ')}`
          : 'Please fill in all required vendor business fields.'
      );
      return;
    }

    const val = this.createForm.getRawValue();
    // Normalize phone number to clean 10 digits
    const rawPhone = String(val.phone).trim().replace(/[\s\-()]/g, '');
    const cleanPhone = rawPhone.replace(/^(?:\+91|91|0)(?=[6-9]\d{9}$)/, '');

    const hasPayoutDetails = Boolean(val.bank_name || val.account_no || val.ifsc || val.upi);
    const payoutAccount: VendorPayoutAccount | undefined = hasPayoutDetails
      ? {
          bank: val.bank_name.trim(),
          accountNo: val.account_no.trim(),
          ifsc: val.ifsc.trim().toUpperCase(),
          upi: val.upi ? val.upi.trim() : undefined,
        }
      : undefined;

    this.admin.addVendor({
      name: val.name.trim(),
      email: val.email.trim().toLowerCase(),
      password: val.password,
      contact_person: val.contact_person.trim(),
      phone: cleanPhone,
      commission_rate: Number(val.commission_rate),
      payout_account: payoutAccount,
    });

    this.isCreateModalOpen.set(false);
  }

  openEditModal(vendor: VendorAccount): void {
    this.editingVendor.set(vendor);
    this.editForm.patchValue({
      contact_person: vendor.contact_person,
      phone: vendor.phone,
      commission_rate: vendor.commission_rate,
      status: vendor.status,
      bank_name: vendor.payout_account?.bank || '',
      account_no: vendor.payout_account?.accountNo || '',
      ifsc: vendor.payout_account?.ifsc || '',
      upi: vendor.payout_account?.upi || '',
    });
    this.isEditModalOpen.set(true);
  }

  closeEditModal(): void {
    this.isEditModalOpen.set(false);
    this.editingVendor.set(null);
  }

  submitEditVendor(): void {
    const v = this.editingVendor();
    if (!v) return;
    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      const invalidFields: string[] = [];
      const c = this.editForm.controls;
      if (c.contact_person.invalid) invalidFields.push('Representative Contact');
      if (c.phone.invalid) invalidFields.push('10-digit Phone Number');
      if (c.commission_rate.invalid) invalidFields.push('Commission Rate (0-50%)');
      
      this.toast.error(
        invalidFields.length
          ? `Please check: ${invalidFields.join(', ')}`
          : 'Please verify vendor details before saving.'
      );
      return;
    }

    const val = this.editForm.getRawValue();
    const rawPhone = String(val.phone).trim().replace(/[\s\-()]/g, '');
    const cleanPhone = rawPhone.replace(/^(?:\+91|91|0)(?=[6-9]\d{9}$)/, '');

    const hasPayoutDetails = Boolean(val.bank_name || val.account_no || val.ifsc || val.upi);
    const payoutAccount: VendorPayoutAccount | undefined = hasPayoutDetails
      ? {
          bank: val.bank_name.trim(),
          accountNo: val.account_no.trim(),
          ifsc: val.ifsc.trim().toUpperCase(),
          upi: val.upi ? val.upi.trim() : undefined,
        }
      : undefined;

    this.admin.updateVendor(v.id, {
      contact_person: val.contact_person.trim(),
      phone: cleanPhone,
      commission_rate: Number(val.commission_rate),
      status: val.status as VendorAccount['status'],
      payout_account: payoutAccount,
    });

    this.isEditModalOpen.set(false);
    this.editingVendor.set(null);
  }

  toggleStatus(vendor: VendorAccount): void {
    this.admin.toggleVendorStatus(vendor.id);
  }

  /**
   * Impersonate / Preview as Vendor in 1 Click
   */
  impersonateVendor(vendor: VendorAccount): void {
    this.account.switchVendorPreview(vendor.name, vendor.id);
    this.toast.info(`🔐 Switched to ${vendor.name} Portal View. Scoped access applied.`);
    void this.router.navigate(['/admin/dashboard']);
  }
}
