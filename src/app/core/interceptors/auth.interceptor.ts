import { HttpInterceptorFn } from '@angular/common/http';
import { inject, isDevMode } from '@angular/core';
import { AccountService } from '../services/account.service';
import { environment } from '../../../environments/environment';

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

  const authReq = req.clone({ url, headers });
  return next(authReq);
};
