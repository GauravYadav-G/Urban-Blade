import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AccountService } from '@core/services/account.service';
import { AdminSessionService } from '@core/services/admin-session.service';

export const adminGuard: CanActivateFn = (route, state) => {
  const account = inject(AccountService);
  const session = inject(AdminSessionService);
  const router = inject(Router);

  const hasStaffRole = account.isAdmin() || account.isVendor();

  // Allow if admin or vendor and session is valid
  if (hasStaffRole && session.isSessionValid()) {
    session.recordActivity();

    // Enforce role-based boundaries for vendor users
    if (account.isVendor()) {
      const url = state.url.toLowerCase();
      const forbiddenForVendors = [
        '/admin/vendors',
        '/admin/bookings',
        '/admin/customers',
        '/admin/coupons',
        '/admin/website',
        '/admin/system',
      ];
      const isForbidden = forbiddenForVendors.some((f) => url.startsWith(f));
      if (isForbidden) {
        return router.createUrlTree(['/admin/dashboard']);
      }
    }

    return true;
  }

  if (hasStaffRole && !session.isSessionValid()) {
    account.adminSignOut();
  }

  // Redirect to dedicated admin login gate with return URL
  return router.createUrlTree(['/admin/login'], {
    queryParams: { returnUrl: state.url || '/admin' },
  });
};
