import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AdminService, type AdminBooking } from '@core/services/admin.service';

@Component({
  selector: 'app-admin-bookings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-bookings.html',
  styleUrl: './admin-bookings.scss',
})
export class AdminBookings {
  readonly admin = inject(AdminService);
  private readonly http = inject(HttpClient);

  readonly selectedStatus = signal<string>('all');
  readonly selectedStylist = signal<string>('all');
  readonly selectedBooking = signal<AdminBooking | null>(null);

  // New Booking Modal State
  readonly isCreateModalOpen = signal(false);
  readonly clientName = signal('');
  readonly clientPhone = signal('');
  readonly clientEmail = signal('');
  readonly stylistName = signal('Vikram Sharma');
  readonly bookingDate = signal(new Date().toISOString().split('T')[0]);
  readonly timeSlot = signal('11:00 AM');
  readonly serviceName = signal('Skin-Fade Haircut & Beard Lineup');
  readonly servicePrice = signal(499);

  readonly filteredBookings = computed(() => {
    let list = this.admin.bookings();
    const status = this.selectedStatus();
    const stylist = this.selectedStylist();

    if (status !== 'all') {
      list = list.filter((b) => b.status === status);
    }
    if (stylist !== 'all') {
      list = list.filter((b) => b.stylist_name === stylist);
    }
    return list;
  });

  readonly stylists = computed(() => {
    const set = new Set<string>();
    this.admin.bookings().forEach((b) => {
      if (b.stylist_name) set.add(b.stylist_name);
    });
    if (set.size === 0) {
      return ['Vikram Sharma', 'Rohan Verma', 'Ayesha Khan'];
    }
    return Array.from(set);
  });

  setStatus(status: string): void {
    this.selectedStatus.set(status);
  }

  setStylist(stylist: string): void {
    this.selectedStylist.set(stylist);
  }

  viewBooking(booking: AdminBooking): void {
    this.selectedBooking.set(booking);
  }

  closeModal(): void {
    this.selectedBooking.set(null);
  }

  openCreateModal(): void {
    this.clientName.set('');
    this.clientPhone.set('');
    this.clientEmail.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  // Reschedule Modal State
  readonly isRescheduleModalOpen = signal(false);
  readonly reschedulingBooking = signal<AdminBooking | null>(null);
  readonly rescheduleDate = signal(new Date().toISOString().split('T')[0]);
  readonly rescheduleSlot = signal('12:00 PM');
  readonly rescheduleStylist = signal('Vikram Sharma');

  openReschedule(b: AdminBooking, event?: Event): void {
    event?.stopPropagation();
    this.reschedulingBooking.set(b);
    this.rescheduleDate.set(b.booking_date);
    this.rescheduleSlot.set(b.time_slot);
    this.rescheduleStylist.set(b.stylist_name || 'Vikram Sharma');
    this.isRescheduleModalOpen.set(true);
  }

  closeReschedule(): void {
    this.isRescheduleModalOpen.set(false);
    this.reschedulingBooking.set(null);
  }

  confirmReschedule(): void {
    const b = this.reschedulingBooking();
    if (!b) return;

    this.admin.rescheduleBooking(
      b.id,
      this.rescheduleDate(),
      this.rescheduleSlot(),
      this.rescheduleStylist()
    );
    this.closeReschedule();
  }

  saveNewBooking(): void {
    if (!this.clientName().trim() || !this.clientPhone().trim()) {
      alert('Please enter client name and phone number.');
      return;
    }

    const booking: AdminBooking = {
      id: `bk-${Date.now().toString().slice(-5)}`,
      customer_name: this.clientName().trim(),
      customer_phone: this.clientPhone().trim(),
      customer_email:
        this.clientEmail().trim() ||
        `${this.clientName().toLowerCase().replace(/\s+/g, '')}@client.in`,
      stylist_name: this.stylistName(),
      booking_date: this.bookingDate(),
      time_slot: this.timeSlot(),
      status: 'confirmed',
      total_price: Number(this.servicePrice()) || 499,
      notes: this.serviceName().trim() || 'Haircut & Beard Grooming',
    };

    this.admin.addBooking(booking);
    this.isCreateModalOpen.set(false);
  }

  updateStatus(booking: AdminBooking, status: 'confirmed' | 'completed' | 'cancelled'): void {
    this.admin.updateBookingStatus(booking.id, status);
    if (this.selectedBooking()?.id === booking.id) {
      this.selectedBooking.update((b) => (b ? { ...b, status } : null));
    }
  }

  exportCSV(): void {
    const list = this.filteredBookings();
    const headers = ['ID', 'Customer_Name', 'Phone', 'Email', 'Stylist', 'Date', 'Time_Slot', 'Status', 'Price_INR', 'Service_Notes'];
    const rows = list.map((b) => [
      b.id,
      `"${b.customer_name.replace(/"/g, '""')}"`,
      b.customer_phone,
      b.customer_email,
      `"${b.stylist_name || 'Master Barber'}"`,
      b.booking_date,
      b.time_slot,
      b.status.toUpperCase(),
      b.total_price,
      `"${(b.notes || '').replace(/"/g, '""')}"`,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `urbanblade_bookings_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
