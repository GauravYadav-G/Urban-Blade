import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { AccountService } from './account.service';
import { AdminSessionService } from './admin-session.service';
import { ToastService } from './toast.service';

describe('Admin inactivity session scenarios', () => {
  let session: AdminSessionService;
  let role: ReturnType<typeof signal<string>>;
  let signOut: jasmine.Spy;
  let navigate: jasmine.Spy;
  const key = 'urban-blade-admin-session-expiry';
  beforeEach(() => {
    jasmine.clock().install(); jasmine.clock().mockDate(new Date('2026-10-13T12:00:00Z'));
    localStorage.removeItem(key); role = signal('none');
    signOut = jasmine.createSpy('signOut'); navigate = jasmine.createSpy('navigate').and.resolveTo(true);
    TestBed.configureTestingModule({ providers: [
      { provide: AccountService, useValue: { isAdmin: () => role() === 'admin', isVendor: () => role() === 'vendor', adminSignOut: signOut } },
      { provide: Router, useValue: { navigate } },
      { provide: ToastService, useValue: { error() {}, success() {}, warning() {} } },
    ] });
    session = TestBed.inject(AdminSessionService); TestBed.tick();
  });
  afterEach(() => { role.set('none'); TestBed.tick(); localStorage.removeItem(key); jasmine.clock().uninstall(); });
  it('AS-01 expires an inactive admin after fifteen minutes', () => {
    role.set('admin'); TestBed.tick(); jasmine.clock().tick(15 * 60 * 1000);
    expect(signOut).toHaveBeenCalledTimes(1); expect(navigate).toHaveBeenCalledWith(['/admin/login'], { queryParams: { expired: '1' } });
  });
  it('AS-02 tracks vendor sessions with the same timeout', () => {
    role.set('vendor'); TestBed.tick(); expect(session.isSessionActive()).toBeTrue();
    jasmine.clock().tick(15 * 60 * 1000); expect(signOut).toHaveBeenCalledTimes(1);
  });
  it('AS-03 interaction refreshes the inactivity deadline', () => {
    role.set('admin'); TestBed.tick(); jasmine.clock().tick(10 * 60 * 1000); session.recordActivity();
    jasmine.clock().tick(6 * 60 * 1000); expect(signOut).not.toHaveBeenCalled(); expect(session.remainingSeconds()).toBe(9 * 60);
  });
  it('AS-04 malformed expiry data fails closed rather than freezing the countdown', () => {
    localStorage.setItem(key, 'not-a-timestamp'); role.set('admin'); TestBed.tick();
    expect(signOut).toHaveBeenCalled(); expect(Number.isFinite(session.remainingSeconds())).toBeTrue();
  });
});
