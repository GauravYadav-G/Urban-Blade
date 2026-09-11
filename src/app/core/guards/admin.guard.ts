import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AccountService } from '@core/services/account.service';
import { AdminSessionService } from '@core/services/admin-session.service';

export const adminGuard: CanActivateFn = (route, state) => {
  const account = inject(AccountService);
  const session = inject(AdminSessionService);
  const router = inject(Router);

  // Allow if admin and session is valid
  if (account.isAdmin() && session.isSessionValid()) {
    session.recordActivity();
    return true;
  }

  if (account.isAdmin() && !session.isSessionValid()) {
    account.adminSignOut();
  }

  // Redirect to dedicated admin login gate with return URL
  return router.createUrlTree(['/admin/login'], {
    queryParams: { returnUrl: state.url || '/admin' },
  });
};
