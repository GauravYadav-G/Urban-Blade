import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AdminService } from '@core/services/admin.service';
import { AccountService } from '@core/services/account.service';
import { ToastService } from '@core/services/toast.service';
import type { VendorAccount } from '@core/models/vendor.model';

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

  // Form for Onboarding Vendor
  readonly createForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['Vendor@2026', [Validators.required, Validators.minLength(6)]],
    contact_person: ['', Validators.required],
    phone: ['', [Validators.required, Validators.pattern('^[0-9]{10}$')]],
    commission_rate: [12, [Validators.required, Validators.min(1), Validators.max(50)]],
    bank_name: ['HDFC Bank', Validators.required],
    account_no: ['', Validators.required],
    ifsc: ['', Validators.required],
    upi: [''],
  });

  // Form for Editing Vendor
  readonly editForm = this.fb.nonNullable.group({
    contact_person: ['', Validators.required],
    phone: ['', [Validators.required, Validators.pattern('^[0-9]{10}$')]],
    commission_rate: [12, [Validators.required, Validators.min(1), Validators.max(50)]],
    status: ['active', Validators.required],
    bank_name: ['', Validators.required],
    account_no: ['', Validators.required],
    ifsc: ['', Validators.required],
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
      (sum, v) => sum + (v.total_sales || 0) * ((v.commission_rate || 12) / 100),
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
      password: 'Vendor@2026',
      contact_person: '',
      phone: '',
      commission_rate: 12,
      bank_name: 'HDFC Bank',
      account_no: '9821445012',
      ifsc: 'HDFC0001234',
      upi: 'vendor@hdfc',
    });
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  submitCreateVendor(): void {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      this.toast.error('Please fill in all required vendor business fields.');
      return;
    }

    const val = this.createForm.getRawValue();
    this.admin.addVendor({
      name: val.name,
      email: val.email.trim().toLowerCase(),
      password: val.password,
      contact_person: val.contact_person,
      phone: val.phone,
      commission_rate: Number(val.commission_rate),
      payout_account: {
        bank: val.bank_name,
        accountNo: val.account_no,
        ifsc: val.ifsc,
        upi: val.upi || undefined,
      },
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
      bank_name: vendor.payout_account?.bank || 'HDFC Bank',
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
    if (!v || this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }

    const val = this.editForm.getRawValue();
    this.admin.updateVendor(v.id, {
      contact_person: val.contact_person,
      phone: val.phone,
      commission_rate: Number(val.commission_rate),
      status: val.status as VendorAccount['status'],
      payout_account: {
        bank: val.bank_name,
        accountNo: val.account_no,
        ifsc: val.ifsc,
        upi: val.upi || undefined,
      },
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
