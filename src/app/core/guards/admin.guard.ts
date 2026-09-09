import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AccountService } from '@core/services/account.service';

export const adminGuard: CanActivateFn = (route, state) => {
  const account = inject(AccountService);
  const router = inject(Router);

  // Allow if admin
  if (account.isAdmin()) {
    return true;
  }

  // Redirect to dedicated admin login gate with return URL
  return router.createUrlTree(['/admin/login'], {
    queryParams: { returnUrl: state.url || '/admin' },
  });
};
