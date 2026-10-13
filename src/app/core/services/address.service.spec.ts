import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { AddressService } from './address.service';
import { AccountService } from './account.service';
import type { StoreUser } from '@core/models/user.model';
import type { SavedAddress } from '@core/models/address.model';

describe('Database-backed address book', () => {
  const address: SavedAddress = { id: '11111111-1111-4111-8111-111111111111', fullName: 'Alice', mobile: '9811223344', house: '12', street: 'Test Road', landmark: '', city: 'Delhi', state: 'Delhi', pinCode: '110001', isDefault: true, location: null };
  const customer: StoreUser = { id: 'customer-a', name: 'Alice', email: 'alice@example.invalid' };
  let user: ReturnType<typeof signal<StoreUser | null>>;
  let http: HttpTestingController;
  let service: AddressService;
  let originalStore: string | null;
  beforeEach(() => {
    originalStore = localStorage.getItem('urban-blade-addresses');
    localStorage.removeItem('urban-blade-addresses');
    user = signal<StoreUser | null>(customer);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: AccountService, useValue: { user } }] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    if (originalStore === null) localStorage.removeItem('urban-blade-addresses');
    else localStorage.setItem('urban-blade-addresses', originalStore);
  });
  it('loads the server address book with no browser cache', async () => {
    service = TestBed.inject(AddressService);
    const loaded = service.load();
    http.expectOne('/api/account/addresses').flush([address]);
    await loaded;
    expect(service.addresses()).toEqual([address]);
  });
  it('imports only the signed-in customer and leaves guest addresses private', async () => {
    localStorage.setItem('urban-blade-addresses', JSON.stringify({ [customer.email]: [address], guest: [{ ...address, fullName: 'Guest' }] }));
    service = TestBed.inject(AddressService);
    const loaded = service.load();
    http.expectOne('/api/account/addresses').flush([]);
    await Promise.resolve();
    const migration = http.expectOne('/api/account/addresses');
    expect(migration.request.method).toBe('POST');
    expect(migration.request.body.fullName).toBe('Alice');
    migration.flush([address]);
    await loaded;
    expect(JSON.parse(localStorage.getItem('urban-blade-addresses') || '{}')[customer.email]).toBeUndefined();
    expect(JSON.parse(localStorage.getItem('urban-blade-addresses') || '{}').guest[0].fullName).toBe('Guest');
  });
  it('does not show another customer addresses after a late response', async () => {
    service = TestBed.inject(AddressService);
    const loaded = service.load();
    const request = http.expectOne('/api/account/addresses');
    user.set({ id: 'customer-b', name: 'Bob', email: 'bob@example.invalid' });
    request.flush([address]);
    await loaded;
    expect(service.addresses()).toEqual([]);
  });
  it('retains the address book after a failed deletion', async () => {
    service = TestBed.inject(AddressService);
    const loaded = service.load();
    http.expectOne('/api/account/addresses').flush([address]);
    await loaded;
    const removed = service.remove(address.id);
    http.expectOne(`/api/account/addresses/${address.id}`).flush({ message: 'Unavailable' }, { status: 503, statusText: 'Unavailable' });
    await expectAsync(removed).toBeRejected();
    expect(service.addresses()).toEqual([address]);
    expect(service.saving()).toBeFalse();
  });
});
