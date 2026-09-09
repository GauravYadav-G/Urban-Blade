import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DEMO_ACCOUNT } from '@core/constants/salon.constants';
import { AccountService } from '@core/services/account.service';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login-page.html',
  styleUrl: './login-page.scss',
})
export class LoginPage {
  private readonly fb = inject(FormBuilder);
  private readonly account = inject(AccountService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly demo = DEMO_ACCOUNT;
  readonly showPassword = signal(false);
  readonly loginError = signal('');

  readonly form = this.fb.nonNullable.group({
    email: [DEMO_ACCOUNT.email, [Validators.required, Validators.email]],
    password: [DEMO_ACCOUNT.password, [Validators.required, Validators.minLength(4)]],
  });

  fillDemo(): void {
    this.form.setValue({ email: DEMO_ACCOUNT.email, password: DEMO_ACCOUNT.password });
    this.loginError.set('');
  }

  togglePassword(): void {
    this.showPassword.update((open) => !open);
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const ok = this.account.signIn(this.form.getRawValue());
    if (!ok) {
      this.loginError.set('Use the dummy login below, or create an account.');
      return;
    }
    const returnUrl = this.route.snapshot.queryParams['returnUrl'];
    const dest = returnUrl || (this.account.isAdmin() ? '/admin' : '/account');
    void this.router.navigateByUrl(dest);
  }
}
