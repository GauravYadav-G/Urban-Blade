import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AccountService } from '../services/account.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const account = inject(AccountService);
  const token = account.getToken();
  const sessionId = account.getSessionId();

  let headers = req.headers;
  if (!headers.has('x-session-id')) {
    headers = headers.set('x-session-id', sessionId);
  }
  if (token && !headers.has('Authorization')) {
    headers = headers.set('Authorization', `Bearer ${token}`);
  }

  const authReq = req.clone({ headers });
  return next(authReq);
};
