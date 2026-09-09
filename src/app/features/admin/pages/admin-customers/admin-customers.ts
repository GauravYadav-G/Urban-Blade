import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, type AdminCustomer } from '@core/services/admin.service';

@Component({
  selector: 'app-admin-customers',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-customers.html',
  styleUrl: './admin-customers.scss',
})
export class AdminCustomers {
  readonly admin = inject(AdminService);

  readonly searchQuery = signal<string>('');
  readonly selectedRole = signal<string>('all');
  readonly selectedCustomerDetails = signal<{ user: any; orders: any[]; bookings: any[] } | null>(null);
  readonly isLoadingDetails = signal(false);

  readonly filteredCustomers = computed(() => {
    let list = this.admin.customers();
    const query = this.searchQuery().toLowerCase().trim();
    const role = this.selectedRole();

    if (query) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.email.toLowerCase().includes(query)
      );
    }

    if (role !== 'all') {
      list = list.filter((c) => c.role === role);
    }

    return list;
  });

  readonly totalSpentSum = computed(() =>
    this.admin.customers().reduce((sum, c) => sum + (Number(c.total_spent) || 0), 0)
  );

  setRoleFilter(role: string): void {
    this.selectedRole.set(role);
  }

  changeRole(customer: AdminCustomer, newRole: 'admin' | 'customer' | 'stylist'): void {
    this.admin.updateCustomerRole(customer.id, newRole);
  }

  inspectCustomer(customer: AdminCustomer): void {
    this.isLoadingDetails.set(true);
    this.admin.fetchCustomerDetails(customer.id).subscribe({
      next: (res) => {
        this.selectedCustomerDetails.set(res);
        this.isLoadingDetails.set(false);
      },
      error: () => {
        this.selectedCustomerDetails.set({
          user: customer,
          orders: [],
          bookings: [],
        });
        this.isLoadingDetails.set(false);
      },
    });
  }

  closeCustomerDetails(): void {
    this.selectedCustomerDetails.set(null);
  }

  exportCSV(): void {
    const list = this.filteredCustomers();
    const headers = ['ID', 'Name', 'Email', 'Role', 'Joined_Date', 'Total_Orders', 'Total_Spent_INR'];
    const rows = list.map((c) => [
      c.id,
      `"${c.name.replace(/"/g, '""')}"`,
      c.email,
      c.role.toUpperCase(),
      c.created_at,
      c.total_orders,
      c.total_spent,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `urbanblade_customers_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
