import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { AdminService, type AdminBooking } from '@core/services/admin.service';
import { StylistsService, type PermanentStylistDeletion, type Stylist } from '@core/services/stylists.service';
import { ToastService } from '@core/services/toast.service';
import { AdminBookings } from './admin-bookings';

describe('Stylist permanent deletion controls', () => {
  let page: AdminBookings;
  let pending: Subject<PermanentStylistDeletion>;
  let api: { list: jasmine.Spy; save: jasmine.Spy; archive: jasmine.Spy; deletePermanently: jasmine.Spy };
  let admin: { bookings: ReturnType<typeof signal<AdminBooking[]>>; refreshBookings: jasmine.Spy; bookingsError: ReturnType<typeof signal<boolean>>; bookingsCheckedAt: ReturnType<typeof signal<string | null>> };
  const stylist: Stylist = { id: 'stylist-1', name: 'Aman Dixit', role: 'Stylist', is_active: true };
  const booking: AdminBooking = {
    id: 'booking-1', customer_name: 'Customer', customer_email: 'customer@example.test', customer_phone: '9811223344',
    booking_date: '2026-10-14', time_slot: '11:00 AM', status: 'confirmed', total_price: 500,
    stylist_id: 'stylist-1', stylist_name: 'Aman Dixit',
  };

  beforeEach(() => {
    pending = new Subject<PermanentStylistDeletion>();
    api = {
      list: jasmine.createSpy('list').and.returnValue(of({ data: [] })),
      save: jasmine.createSpy('save'),
      archive: jasmine.createSpy('archive').and.returnValue(of({ ok: true, archived: true })),
      deletePermanently: jasmine.createSpy('deletePermanently').and.returnValue(pending),
    };
    admin = {
      bookings: signal([booking]), refreshBookings: jasmine.createSpy('refreshBookings'),
      bookingsError: signal(false), bookingsCheckedAt: signal<string | null>(null),
    };
    TestBed.configureTestingModule({ providers: [
      { provide: StylistsService, useValue: api },
      { provide: AdminService, useValue: admin },
      { provide: ToastService, useValue: { success: jasmine.createSpy(), error: jasmine.createSpy() } },
    ] });
    page = TestBed.runInInjectionContext(() => new AdminBookings());
    page.stylistRecords.set([stylist]);
  });
  afterEach(() => pending.complete());

  it('requires the exact typed name and supports archived records', () => {
    page.openPermanentStylistDelete({ ...stylist, is_active: false });
    page.deleteConfirmationName.set('aman dixit');
    page.confirmPermanentStylistDelete();
    expect(api.deletePermanently).not.toHaveBeenCalled();
    expect(page.stylistDeleteError()).toContain('exactly');
    page.deleteConfirmationName.set('  Aman Dixit  ');
    page.confirmPermanentStylistDelete();
    expect(api.deletePermanently).toHaveBeenCalledOnceWith('stylist-1', 'Aman Dixit');
    expect(api.archive).not.toHaveBeenCalled();
  });

  it('prevents repeat submissions and preserves the confirmation after an error', () => {
    page.openPermanentStylistDelete(stylist);
    page.deleteConfirmationName.set(stylist.name);
    page.confirmPermanentStylistDelete();
    page.confirmPermanentStylistDelete();
    page.closePermanentStylistDelete();
    expect(api.deletePermanently).toHaveBeenCalledTimes(1);
    expect(page.pendingStylistDelete()?.id).toBe(stylist.id);
    pending.error({ error: { message: 'The stylist name changed. Refresh the directory and try again.' } });
    expect(page.stylistDeleting()).toBeFalse();
    expect(page.deleteConfirmationName()).toBe(stylist.name);
    expect(page.stylistDeleteError()).toContain('name changed');
    expect(page.stylistRecords()).toEqual([stylist]);
    expect(admin.bookings()).toEqual([booking]);
  });

  it('clears deleted assignments and all dangling selections while keeping bookings', () => {
    const anotherBooking = { ...booking, id: 'booking-2', stylist_id: 'stylist-2', stylist_name: 'Other Stylist' };
    admin.bookings.set([booking, anotherBooking]);
    page.selectedStylist.set(stylist.id);
    page.editStylist(stylist);
    page.stylistName.set(stylist.id);
    page.rescheduleStylist.set(stylist.id);
    page.inspectingBooking.set(booking);
    page.reschedulingBooking.set(booking);
    page.openPermanentStylistDelete(stylist);
    page.deleteConfirmationName.set(stylist.name);
    page.confirmPermanentStylistDelete();
    pending.next({ ok: true, deleted: true, id: stylist.id, unassignedBookings: 1, message: 'Stylist permanently deleted.' });
    pending.complete();
    expect(page.selectedStylist()).toBe('all');
    expect(page.editingStylist()).toBeNull();
    expect(page.staffName()).toBe('');
    expect(page.stylistName()).toBe('');
    expect(page.rescheduleStylist()).toBe('');
    expect(page.inspectingBooking()?.stylist_id).toBeUndefined();
    expect(page.reschedulingBooking()?.stylist_name).toBeUndefined();
    expect(admin.bookings().length).toBe(2);
    expect(admin.bookings()[0].stylist_id).toBeUndefined();
    expect(admin.bookings()[1]).toBe(anotherBooking);
    expect(api.list).toHaveBeenCalled();
    expect(admin.refreshBookings).toHaveBeenCalled();
    expect(page.pendingStylistDelete()).toBeNull();
  });

  it('archives through the archive endpoint and preserves historical assignments', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    page.archiveStylist(stylist);
    expect(api.archive).toHaveBeenCalledOnceWith(stylist.id);
    expect(api.deletePermanently).not.toHaveBeenCalled();
    expect(admin.bookings()[0].stylist_id).toBe(stylist.id);
    expect(admin.bookings()[0].stylist_name).toBe(stylist.name);
  });

  it('renders permanently delete for both active and archived directory rows', () => {
    api.list.and.returnValue(of({ data: [stylist, { ...stylist, id: 'stylist-2', is_active: false }] }));
    const fixture = TestBed.createComponent(AdminBookings);
    fixture.detectChanges();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('.staff-actions button')) as HTMLButtonElement[];
    expect(buttons.filter(button => button.textContent?.trim() === 'Permanently delete').length).toBe(2);
    expect(buttons.filter(button => button.textContent?.trim() === 'Archive').length).toBe(1);
    fixture.destroy();
  });
});
