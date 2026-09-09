import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AccountService } from '@core/services/account.service';

export const guestGuard: CanActivateFn = () => {
  const account = inject(AccountService);
  const router = inject(Router);
  return account.isSignedIn() ? router.createUrlTree(['/account']) : true;
};
