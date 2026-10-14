import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { adminGuard } from './admin.guard';
import { routes } from '../../app.routes';
import { AccountService } from '../services/account.service';
import { AdminSessionService } from '../services/admin-session.service';

@Component({ template: '<router-outlet />', imports: [RouterOutlet] })
class AdminShell {}
@Component({ template: 'Screen' })
class Screen {}

describe('Admin child route authorization', () => {
  it('checks restricted screens when a vendor is already inside the admin layout', async () => {
    const adminRoute = routes.find(route => route.path === 'admin')!;
    TestBed.configureTestingModule({ providers: [
      provideRouter([{ ...adminRoute, loadComponent: undefined, component: AdminShell, children: [
        { path: 'dashboard', component: Screen },
        { path: 'customers', component: Screen },
        { path: 'support', component: Screen },
        { path: 'returns', component: Screen },
        { path: 'products', component: Screen },
      ] }]),
      { provide: AccountService, useValue: { isAdmin: () => false, isVendor: () => true } },
      { provide: AdminSessionService, useValue: { isSessionValid: () => true, recordActivity: () => {} } },
    ] });
    expect(adminRoute.canActivateChild).toContain(adminGuard);
    const harness = await RouterTestingHarness.create('/admin/dashboard');
    await harness.navigateByUrl('/admin/customers');
    expect(TestBed.inject(Router).url).toBe('/admin/dashboard');
    await harness.navigateByUrl('/admin/support');
    expect(TestBed.inject(Router).url).toBe('/admin/dashboard');
    await harness.navigateByUrl('/admin/returns');
    expect(TestBed.inject(Router).url).toBe('/admin/dashboard');
    await harness.navigateByUrl('/admin/%63ustomers');
    expect(TestBed.inject(Router).url).toBe('/admin/dashboard');
    await harness.navigateByUrl('/admin/products');
    expect(TestBed.inject(Router).url).toBe('/admin/products');
  });
});
