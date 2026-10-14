import { StylistsService, type Stylist } from '@core/services/stylists.service';
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { AdminService, type AdminBooking } from '@core/services/admin.service';
import { ToastService } from '@core/services/toast.service';
import { AdminDialog } from '@shared/directives/admin-dialog';

type VisitSegment = 'all' | 'salon' | 'home';
type BookingStatus = 'all' | AdminBooking['status'];

@Component({
  selector: 'app-admin-bookings',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminDialog],
  templateUrl: './admin-bookings.html',
  styleUrl: './admin-bookings.scss',
})
export class AdminBookings implements OnInit {
  readonly admin = inject(AdminService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private rosterRequest = 0;

  readonly activeVisitType = signal<VisitSegment>('all');
  readonly selectedStatus = signal<BookingStatus>('all');
  readonly selectedStylist = signal<string>('all');
  readonly selectedDate = signal<string>('');
  readonly searchQuery = signal('');
  readonly isSaving = signal(false);

  // Inspector / Details Modal
  readonly isDetailsModalOpen = signal(false);
  readonly inspectingBooking = signal<AdminBooking | null>(null);

  // Create Booking Modal State
  readonly isCreateModalOpen = signal(false);
  readonly clientName = signal('');
  readonly clientPhone = signal('');
  readonly clientEmail = signal('');
  readonly bookingDate = signal(new Date().toISOString().slice(0, 10));
  readonly timeSlot = signal('11:00 AM');
  readonly serviceName = signal('');
  readonly servicePrice = signal<number | null>(null);
  readonly visitType = signal<'salon' | 'home'>('salon');
  readonly serviceAddress = signal('');
  readonly stylistName = signal('');

  // Reschedule Modal State
  readonly isRescheduleModalOpen = signal(false);
  readonly reschedulingBooking = signal<AdminBooking | null>(null);
  readonly rescheduleDate = signal('');
  readonly rescheduleSlot = signal('');
  readonly rescheduleVisitType = signal<'salon' | 'home'>('salon');
  readonly rescheduleAddress = signal('');
  readonly rescheduleStylist = signal('');

  readonly timeSlots = [
    '09:00 AM',
    '10:00 AM',
    '11:00 AM',
    '12:00 PM',
    '01:00 PM',
    '02:00 PM',
    '03:00 PM',
    '04:00 PM',
    '05:00 PM',
    '06:00 PM',
    '07:00 PM',
    '08:00 PM',
  ];

  private readonly stylistApi = inject(StylistsService);
  readonly stylistRecords = signal<Stylist[]>([]);
  readonly stylists = computed(() => {
    const seen = new Set<string>();
    return this.stylistRecords()
      .filter((s) => s.is_active)
      .filter((s) => {
        const key = s.name.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  });
  readonly stylistError = signal('');
  readonly stylistSaving = signal(false);
  readonly editingStylist = signal<string | null>(null);
  readonly staffName = signal('');
  readonly staffRole = signal('Stylist');
  readonly stylistLoading = signal(false);
  readonly archivingStylist = signal<string | null>(null);
  readonly pendingStylistDelete = signal<Stylist | null>(null);
  readonly deleteConfirmationName = signal('');
  readonly stylistDeleting = signal(false);
  readonly stylistDeleteError = signal('');
  readonly stylistMutating = computed(() => this.stylistSaving() || this.archivingStylist() !== null || this.stylistDeleting());
  readonly canConfirmStylistDelete = computed(() => {
    const stylist = this.pendingStylistDelete();
    return stylist !== null && !this.stylistMutating() && !this.isSaving() &&
      this.deleteConfirmationName().trim() === stylist.name.trim();
  });

  loadStylists(): void {
    const request = ++this.rosterRequest;
    this.stylistLoading.set(true);
    this.stylistApi.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (r) => {
        if (request !== this.rosterRequest) return;
        this.stylistLoading.set(false);
        this.stylistRecords.set(r.data);
        this.stylistError.set('');
      },
      error: () => {
        if (request !== this.rosterRequest) return;
        this.stylistLoading.set(false);
        this.stylistError.set('Stylist records could not be loaded. Retry before assigning staff.');
      },
    });
  }

  editStylist(stylist: Stylist): void {
    if (this.stylistMutating()) return;
    this.editingStylist.set(stylist.id);
    this.staffName.set(stylist.name);
    this.staffRole.set(stylist.role);
  }

  resetStylist(): void {
    this.editingStylist.set(null);
    this.staffName.set('');
    this.staffRole.set('Stylist');
  }

  saveStylist(): void {
    if (this.stylistMutating()) return;
    const name = this.staffName().trim();
    const role = this.staffRole().trim();
    if (name.length < 2 || name.length > 255 || role.length < 2 || role.length > 100) {
      this.stylistError.set('Enter a name of 2–255 characters and a role of 2–100 characters.');
      return;
    }
    if (!this.editingStylist()) {
      const exists = this.stylistRecords().some((s) => s.name.trim().toLowerCase() === name.toLowerCase());
      if (exists) {
        this.stylistError.set(`A stylist named "${name}" already exists in the roster.`);
        return;
      }
    }
    this.stylistSaving.set(true);
    this.stylistApi.save(this.editingStylist(), { name, role, is_active: true }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.stylistSaving.set(false);
        this.resetStylist();
        this.loadStylists();
        this.admin.refreshBookings();
      },
      error: (err) => {
        this.stylistSaving.set(false);
        const msg = err?.error?.message || 'Stylist could not be saved. Enter a name and role of at least two characters.';
        this.stylistError.set(msg);
      }
    });
  }

  archiveStylist(stylist: Stylist): void {
    if (this.stylistMutating() || !stylist.is_active) return;
    if (!confirm(`Archive ${stylist.name}? This prevents new assignments and keeps existing booking assignments and the stylist record.`)) return;
    this.archivingStylist.set(stylist.id);
    this.stylistApi.archive(stylist.id).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.archivingStylist.set(null))).subscribe({
      next: response => {
        if (!response?.ok || !response.archived) {
          this.stylistError.set('The archive was not confirmed. Refresh the directory before retrying.');
          return;
        }
        this.stylistRecords.update(records => records.map(record => record.id === stylist.id ? { ...record, is_active: false } : record));
        if (this.stylistName() === stylist.id) this.stylistName.set('');
        if (this.rescheduleStylist() === stylist.id) this.rescheduleStylist.set('');
        this.loadStylists();
        this.toast.success(`${stylist.name} archived. Existing booking assignments are preserved.`);
      },
      error: error => this.stylistError.set(error.error?.message || 'Stylist could not be archived. Refresh the directory and retry.'),
    });
  }

  openPermanentStylistDelete(stylist: Stylist): void {
    if (this.stylistMutating() || this.isSaving()) return;
    this.pendingStylistDelete.set({ ...stylist });
    this.deleteConfirmationName.set('');
    this.stylistDeleteError.set('');
  }

  closePermanentStylistDelete(): void {
    if (this.stylistDeleting()) return;
    this.pendingStylistDelete.set(null);
    this.deleteConfirmationName.set('');
    this.stylistDeleteError.set('');
  }

  confirmPermanentStylistDelete(): void {
    const stylist = this.pendingStylistDelete();
    if (!stylist || this.stylistMutating() || this.isSaving()) return;
    if (this.deleteConfirmationName().trim() !== stylist.name.trim()) {
      this.stylistDeleteError.set('Type the stylist name exactly as shown to confirm permanent deletion.');
      return;
    }
    this.stylistDeleting.set(true);
    this.stylistDeleteError.set('');
    this.stylistApi.deletePermanently(stylist.id, this.deleteConfirmationName().trim()).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.stylistDeleting.set(false))
    ).subscribe({
      next: response => {
        this.stylistRecords.update(records => records.filter(record => record.id !== stylist.id));
        this.clearDeletedStylistAssignments(stylist.id);
        this.pendingStylistDelete.set(null);
        this.deleteConfirmationName.set('');
        this.loadStylists();
        this.admin.refreshBookings();
        this.toast.success(response.message || `${stylist.name} permanently deleted. ${response.unassignedBookings} booking assignments cleared.`);
      },
      error: error => this.stylistDeleteError.set(error.error?.message || 'Permanent deletion could not be confirmed. Refresh the directory to check the record, then retry.'),
    });
  }

  private clearDeletedStylistAssignments(stylistId: string): void {
    if (this.selectedStylist() === stylistId) this.selectedStylist.set('all');
    if (this.editingStylist() === stylistId) this.resetStylist();
    if (this.stylistName() === stylistId) this.stylistName.set('');
    if (this.rescheduleStylist() === stylistId) this.rescheduleStylist.set('');
    const unassign = (booking: AdminBooking): AdminBooking => booking.stylist_id === stylistId
      ? { ...booking, stylist_id: undefined, stylist_name: undefined }
      : booking;
    this.admin.bookings.update(bookings => bookings.map(unassign));
    this.inspectingBooking.update(booking => booking ? unassign(booking) : null);
    this.reschedulingBooking.update(booking => booking ? unassign(booking) : null);
  }

  readonly salonCount = computed(() =>
    this.admin.bookings().filter((b) => (b.visit_type || 'salon') === 'salon').length
  );

  readonly homeCount = computed(() =>
    this.admin.bookings().filter((b) => b.visit_type === 'home').length
  );

  readonly todayArrivalsCount = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    return this.admin
      .bookings()
      .filter(
        (b) =>
          (b.visit_type || 'salon') === 'salon' &&
          (b.booking_date || '').slice(0, 10) === today &&
          b.status !== 'cancelled'
      ).length;
  });

  readonly homeRoutesCount = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    return this.admin
      .bookings()
      .filter(
        (b) =>
          b.visit_type === 'home' &&
          (b.booking_date || '').slice(0, 10) === today &&
          b.status !== 'cancelled'
      ).length;
  });

  readonly unassignedCount = computed(() => this.admin.bookings().filter(b => !b.stylist_id && ['pending','confirmed'].includes(b.status)).length);

  readonly filteredBookings = computed(() => {
    const type = this.activeVisitType();
    const status = this.selectedStatus();
    const stylist = this.selectedStylist();
    const date = this.selectedDate();
    const query = this.searchQuery().trim().toLowerCase();

    return this.admin.bookings().filter((b) => {
      const bType = b.visit_type || 'salon';
      const matchesType = type === 'all' || bType === type;
      const matchesStatus = status === 'all' || b.status === status;
      const matchesStylist =
        stylist === 'all' || b.stylist_id === stylist;
      const matchesDate = !date || (b.booking_date || '').slice(0, 10) === date;
      const matchesSearch =
        !query ||
        [
          b.customer_name,
          b.customer_phone,
          b.customer_email,
          b.notes,
          b.service_address,
          b.stylist_name,
        ].some((val) => String(val || '').toLowerCase().includes(query));

      return matchesType && matchesStatus && matchesStylist && matchesDate && matchesSearch;
    });
  });

  ngOnInit(): void {
    this.admin.refreshBookings();
    this.loadStylists();
  }

  setVisitType(type: VisitSegment): void {
    this.activeVisitType.set(type);
  }

  setStatus(status: BookingStatus): void {
    this.selectedStatus.set(status);
  }

  filterToday(): void {
    this.selectedDate.set(new Date().toISOString().slice(0, 10));
  }

  clearDate(): void {
    this.selectedDate.set('');
  }

  openCreateModal(): void {
    this.clientName.set('');
    this.clientPhone.set('');
    this.clientEmail.set('');
    this.bookingDate.set(new Date().toISOString().slice(0, 10));
    this.timeSlot.set('11:00 AM');
    this.serviceName.set('');
    this.servicePrice.set(null);
    this.visitType.set(this.activeVisitType() === 'home' ? 'home' : 'salon');
    this.serviceAddress.set('');
    this.stylistName.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    if (!this.isSaving()) this.isCreateModalOpen.set(false);
  }

  saveNewBooking(): void {
    const name = this.clientName().trim();
    const phone = this.clientPhone().trim();
    const date = this.bookingDate();
    const slot = this.timeSlot().trim();
    const price = Number(this.servicePrice());
    const isHome = this.visitType() === 'home';
    const address = this.serviceAddress().trim();

    if (!name || name.length < 2) {
      this.toast.error('Client name must be at least 2 characters.');
      return;
    }
    if (!/^[0-9+ -]{10,18}$/.test(phone)) {
      this.toast.error('Please enter a valid 10-digit customer mobile number.');
      return;
    }
    if (!date) {
      this.toast.error('Please pick an appointment date.');
      return;
    }
    if (!slot) {
      this.toast.error('Please select an appointment time slot.');
      return;
    }
    if (!this.serviceName().trim() || this.servicePrice() === null || !Number.isFinite(price) || price < 0) {
      this.toast.error('Service fee must be a valid positive amount.');
      return;
    }
    if (isHome && address.length < 6) {
      this.toast.error('Home visits require a complete service destination address.');
      return;
    }

    const booking: AdminBooking = {
      id: crypto.randomUUID(),
      customer_name: name,
      customer_phone: phone,
      customer_email: this.clientEmail().trim(),
      booking_date: date,
      time_slot: slot,
      visit_type: isHome ? 'home' : 'salon',
      service_address: isHome ? address : null,
      stylist_id: this.stylistName() || undefined,
      status: 'confirmed',
      total_price: price,
      notes: this.serviceName().trim() || 'Salon Care Service',
    };

    this.isSaving.set(true);
    this.admin.addBooking(booking).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.isCreateModalOpen.set(false);
        this.toast.success(
          `Appointment for ${booking.customer_name} successfully confirmed!`
        );
      },
      error: (err) => {
        this.isSaving.set(false);
        this.toast.error(
          err.error?.message || 'Appointment could not be saved to server.'
        );
      },
    });
  }

  openReschedule(booking: AdminBooking, event?: Event): void {
    event?.stopPropagation();
    this.reschedulingBooking.set(booking);
    const cleanDate =
      (booking.booking_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    this.rescheduleDate.set(cleanDate);
    this.rescheduleSlot.set(booking.time_slot || '11:00 AM');
    this.rescheduleVisitType.set(booking.visit_type || 'salon');
    this.rescheduleAddress.set(booking.service_address || '');
    this.rescheduleStylist.set(booking.stylist_id || '');
    this.isRescheduleModalOpen.set(true);
  }

  closeReschedule(): void {
    if (this.isSaving()) return;
    this.isRescheduleModalOpen.set(false);
    this.reschedulingBooking.set(null);
  }

  confirmReschedule(): void {
    const booking = this.reschedulingBooking();
    if (!booking) return;

    const date = this.rescheduleDate();
    const slot = this.rescheduleSlot().trim();
    const isHome = this.rescheduleVisitType() === 'home';
    const address = this.rescheduleAddress().trim();

    if (!date || !slot) {
      this.toast.error('Specify both the new date and time slot.');
      return;
    }
    if (isHome && address.length < 6) {
      this.toast.error('Home visits require a destination address.');
      return;
    }

    this.isSaving.set(true);
    this.admin
      .rescheduleBooking(
        booking.id,
        date,
        slot,
        this.rescheduleVisitType(),
        isHome ? address : null,
        this.rescheduleStylist()
      )
      .subscribe({
        next: (saved) => {
          this.isSaving.set(false);
          this.closeReschedule();
          if (this.inspectingBooking()?.id === booking.id) {
            this.inspectingBooking.set(saved);
          }
          this.toast.success(
            `Appointment rescheduled to ${saved.booking_date} at ${saved.time_slot}.`
          );
        },
        error: (err) => {
          this.isSaving.set(false);
          this.toast.error(
            err.error?.message || 'Failed to reschedule appointment.'
          );
        },
      });
  }

  openDetails(booking: AdminBooking, event?: Event): void {
    event?.stopPropagation();
    this.inspectingBooking.set(booking);
    this.isDetailsModalOpen.set(true);
  }

  closeDetails(): void {
    this.isDetailsModalOpen.set(false);
    this.inspectingBooking.set(null);
  }

  updateStatus(
    booking: AdminBooking,
    status: AdminBooking['status'],
    event?: Event
  ): void {
    event?.stopPropagation();
    this.admin.updateBookingStatus(booking.id,status).subscribe({next:saved=>{
      if(this.inspectingBooking()?.id===booking.id)this.inspectingBooking.update(current=>current?{...current,...saved}:null);
      this.toast.success('Booking status saved.');
    },error:()=>this.toast.error('Booking status was not saved. Refresh and retry.')});
  }

  exportCSV(): void {
    const list = this.filteredBookings();
    const headers = [
      'Appointment_ID',
      'Location_Type',
      'Client_Name',
      'Mobile',
      'Email',
      'Stylist_Barber',
      'Date',
      'Time_Slot',
      'Status',
      'Service_Notes',
      'Home_Address',
      'Service_Fee_INR',
    ];
    const escape = (val: unknown) =>
      `"${String(val ?? '').replace(/"/g, '""')}"`;
    const rows = list.map((b) => [
      b.id,
      b.visit_type === 'home' ? 'Home Service' : 'Salon Studio',
      b.customer_name,
      b.customer_phone,
      b.customer_email || 'N/A',
      b.stylist_name || 'Unassigned',
      (b.booking_date || '').slice(0, 10),
      b.time_slot,
      b.status.toUpperCase(),
      b.notes || 'Salon Care',
      b.service_address || 'In-Studio',
      b.total_price,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map(escape).join(','))
      .join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8' })
    );
    link.download = `urbanblade_appointments_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    this.toast.info(`Exported ${list.length} appointments to CSV.`);
  }
}
