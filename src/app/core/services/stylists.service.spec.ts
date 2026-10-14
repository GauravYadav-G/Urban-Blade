import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { StylistsService } from './stylists.service';

describe('Stylist deletion API boundaries', () => {
  let service: StylistsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(StylistsService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('keeps archival separate from permanent deletion', () => {
    service.archive('stylist-1').subscribe();
    const archive = http.expectOne('/api/admin/stylists/stylist-1');
    expect(archive.request.method).toBe('DELETE');
    expect(archive.request.body).toBeNull();
    archive.flush({ ok: true, archived: true });
    service.deletePermanently('stylist-1', 'Aman Dixit').subscribe(response => expect(response.unassignedBookings).toBe(2));
    const deletion = http.expectOne('/api/admin/stylists/stylist-1/permanent');
    expect(deletion.request.method).toBe('DELETE');
    expect(deletion.request.body).toEqual({ confirmationName: 'Aman Dixit' });
    deletion.flush({ ok: true, deleted: true, id: 'stylist-1', unassignedBookings: 2, message: 'Stylist deleted; bookings retained.' });
  });

  it('rejects a mismatched or unconfirmed deletion response', () => {
    const failure = jasmine.createSpy('failure');
    service.deletePermanently('stylist-1', 'Aman Dixit').subscribe({ error: failure });
    http.expectOne('/api/admin/stylists/stylist-1/permanent').flush({ ok: true, deleted: true, id: 'another-stylist', unassignedBookings: 0 });
    expect(failure).toHaveBeenCalled();
  });

  it('preserves active and archived entries sharing a legacy name', () => {
    service.list().subscribe(response => expect(response.data.length).toBe(2));
    http.expectOne('/api/admin/stylists').flush({ data: [
      { id: 'stylist-1', name: 'Aman Dixit', role: 'Stylist', is_active: true },
      { id: 'stylist-2', name: 'Aman Dixit', role: 'Stylist', is_active: false },
    ] });
  });
});
