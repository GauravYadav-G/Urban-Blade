import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { AdminService, type AdminCustomer } from '@core/services/admin.service';
import type { AdminTask } from '@core/models/support.model';
import { ToastService } from '@core/services/toast.service';

@Component({
  selector: 'app-admin-customers',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './admin-customers.html',
  styleUrl: './admin-customers.scss',
})
export class AdminCustomers {
  readonly admin = inject(AdminService);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);

  readonly activeTab = signal<'users' | 'tasks'>('users');
  readonly searchQuery = signal<string>('');
  readonly selectedRole = signal<string>('all');
  readonly selectedCustomerDetails = signal<{ user: any; orders: any[]; bookings: any[] } | null>(null);
  readonly isLoadingDetails = signal(false);

  // Task Operations State
  readonly taskFilter = signal<'all' | 'pending' | 'in_progress' | 'completed'>('all');
  readonly isCreateTaskModalOpen = signal<boolean>(false);

  readonly taskForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(3)]],
    description: [''],
    assignee: ['Master Admin', Validators.required],
    priority: ['medium' as AdminTask['priority'], Validators.required],
    due_date: ['Tomorrow, 5 PM', Validators.required],
    related_user: [''],
  });

  // Filtered Users
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

  // Filtered Tasks
  readonly filteredTasks = computed(() => {
    const list = this.admin.adminTasks();
    const filter = this.taskFilter();
    if (filter === 'all') return list;
    return list.filter((t) => t.status === filter);
  });

  readonly pendingTasksCount = computed(
    () => this.admin.adminTasks().filter((t) => t.status === 'pending').length
  );
  readonly inProgressTasksCount = computed(
    () => this.admin.adminTasks().filter((t) => t.status === 'in_progress').length
  );
  readonly completedTasksCount = computed(
    () => this.admin.adminTasks().filter((t) => t.status === 'completed').length
  );

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

  // Task Operations Methods
  openCreateTaskModal(relatedUser?: string): void {
    this.taskForm.reset({
      title: '',
      description: '',
      assignee: 'Master Admin',
      priority: 'medium',
      due_date: 'Tomorrow, 5 PM',
      related_user: relatedUser || '',
    });
    this.isCreateTaskModalOpen.set(true);
  }

  closeCreateTaskModal(): void {
    this.isCreateTaskModalOpen.set(false);
  }

  submitCreateTask(): void {
    if (this.taskForm.invalid) {
      this.taskForm.markAllAsTouched();
      return;
    }

    const val = this.taskForm.getRawValue();
    this.admin.addTask(val);
    this.isCreateTaskModalOpen.set(false);
  }

  advanceTaskStatus(task: AdminTask): void {
    const nextStatus: AdminTask['status'] =
      task.status === 'pending'
        ? 'in_progress'
        : task.status === 'in_progress'
        ? 'completed'
        : 'pending';
    this.admin.updateTaskStatus(task.id, nextStatus);
  }

  deleteTask(task: AdminTask, event?: Event): void {
    event?.stopPropagation();
    if (confirm(`Remove task "${task.title}"?`)) {
      this.admin.deleteTask(task.id);
    }
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
    link.setAttribute('download', `urbanblade_users_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
