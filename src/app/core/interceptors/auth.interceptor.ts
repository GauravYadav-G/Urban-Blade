import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject, isDevMode } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AccountService } from '../services/account.service';
import { environment } from '../../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const account = inject(AccountService);
  const token = account.getToken();
  const sessionId = account.getSessionId();

  // Prepend Render API backend URL when running in production (e.g. GoDaddy -> Render)
  let url = req.url;
  const isProd = !isDevMode() || environment.production;
  const apiHost = (environment.apiUrl || 'https://urbanblade-api.onrender.com').replace(/\/$/, '');

  if (isProd) {
    if (url.startsWith('/api')) {
      url = `${apiHost}${url}`;
    } else if (url.startsWith('http://localhost:4000')) {
      url = url.replace('http://localhost:4000', apiHost);
    }
  }

  const target = new URL(url, window.location.origin);
  const allowedOrigins = new Set([window.location.origin, new URL(apiHost).origin]);
  if (!isProd) allowedOrigins.add('http://localhost:4000');
  if (!allowedOrigins.has(target.origin) || !target.pathname.startsWith('/api/')) return next(req);
  let headers = req.headers;
  if (!headers.has('x-session-id')) headers = headers.set('x-session-id', sessionId);
  if (token && !headers.has('Authorization')) headers = headers.set('Authorization', `Bearer ${token}`);
  const authReq = req.clone({ url, headers });

  return next(authReq).pipe(
    catchError((err: unknown) => {
      if (
        err instanceof HttpErrorResponse &&
        err.status === 401 &&
        !url.includes('/auth/login') &&
        !url.includes('/auth/register') &&
        !url.includes('/auth/refresh')
      ) {
        return from(account.refreshSession()).pipe(
          switchMap((newToken) => {
            if (!newToken) return throwError(() => err);
            const retriedReq = authReq.clone({
              headers: authReq.headers.set('Authorization', `Bearer ${newToken}`),
            });
            return next(retriedReq);
          })
        );
      }
      return throwError(() => err);
    })
  );
};

