import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DEMO_ACCOUNT, ADMIN_ACCOUNT, SALON } from '@core/constants/salon.constants';
import { AccountService } from '@core/services/account.service';

export type AuthMode = 'login' | 'register';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login-page.html',
  styleUrl: './login-page.scss',
})
export class LoginPage {
  private readonly fb = inject(FormBuilder);
  private readonly account = inject(AccountService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly salon = SALON;
  readonly demoCustomer = DEMO_ACCOUNT;
  readonly demoAdmin = ADMIN_ACCOUNT;

  // Determine initial mode based on current URL path
  readonly mode = signal<AuthMode>(
    this.route.snapshot.routeConfig?.path === 'register' || this.router.url.includes('/register')
      ? 'register'
      : 'login'
  );

  readonly showPassword = signal(false);
  readonly showConfirmPassword = signal(false);
  readonly loading = signal(false);
  readonly loginError = signal('');
  readonly registerError = signal('');
  readonly successMessage = signal('');
  readonly showForgotModal = signal(false);
  readonly demoFilledBadge = signal<string | null>(null);

  // Sign In Form
  readonly loginForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(4)]],
    rememberMe: [true],
  });

  // Create Account Form
  readonly registerForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', [Validators.pattern(/^(\+91[\s-]?)?[6-9]\d{9}$/)]],
    password: ['', [Validators.required, Validators.minLength(10)]],
    confirmPassword: ['', [Validators.required]],
    agreeTerms: [true, [Validators.requiredTrue]],
  });

  readonly registrationValues = toSignal(this.registerForm.valueChanges, { initialValue: this.registerForm.getRawValue() });

  // Dynamic Password Strength Meter
  readonly passwordStrength = computed(() => {
    const pwd = this.registrationValues().password || '';
    if (!pwd) return { score: 0, label: 'None', textClass: '', bars: [false, false, false, false] };

    let score = 0;
    if (pwd.length >= 6) score += 1;
    if (pwd.length >= 8) score += 1;
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score += 1;
    if (/[0-9]/.test(pwd) || /[^A-Za-z0-9]/.test(pwd)) score += 1;

    let label = 'Weak';
    let textClass = 'strength--weak';
    if (score === 2) {
      label = 'Fair';
      textClass = 'strength--fair';
    } else if (score === 3) {
      label = 'Good';
      textClass = 'strength--good';
    } else if (score >= 4) {
      label = 'Strong';
      textClass = 'strength--strong';
    }

    return {
      score,
      label,
      textClass,
      bars: [score >= 1, score >= 2, score >= 3, score >= 4],
    };
  });

  // Dynamic Confirm Password Match
  readonly passwordsMatch = computed(() => {
    const pwd = this.registrationValues().password || '';
    const confirm = this.registrationValues().confirmPassword || '';
    if (!confirm) return null;
    return pwd === confirm;
  });

  switchMode(target: AuthMode): void {
    if (this.mode() === target) return;
    this.mode.set(target);
    this.loginError.set('');
    this.registerError.set('');
    this.successMessage.set('');
    this.demoFilledBadge.set(null);

    // Update URL seamlessly without full reloads
    void this.router.navigate([target === 'register' ? '/register' : '/login'], {
      replaceUrl: true,
      queryParamsHandling: 'preserve',
    });
  }

  fillCustomerDemo(): void {
    this.mode.set('login');
    this.loginForm.patchValue({
      email: this.demoCustomer.email,
      password: this.demoCustomer.password,
    });
    this.loginError.set('');
    this.demoFilledBadge.set('Customer demo filled');
    setTimeout(() => this.demoFilledBadge.set(null), 3000);
  }

  fillAdminDemo(): void {
    this.mode.set('login');
    this.loginForm.patchValue({
      email: this.demoAdmin.email,
      password: this.demoAdmin.password,
    });
    this.loginError.set('');
    this.demoFilledBadge.set('Master Admin demo filled');
    setTimeout(() => this.demoFilledBadge.set(null), 3000);
  }

  togglePassword(): void {
    this.showPassword.update((val) => !val);
  }

  toggleConfirmPassword(): void {
    this.showConfirmPassword.update((val) => !val);
  }

  toggleForgotModal(open: boolean): void {
    this.showForgotModal.set(open);
  }

  async submitLogin(): Promise<void> {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.loginError.set('');
    this.successMessage.set('');

    try {
      const ok = await this.account.signIn({
        email: this.loginForm.controls.email.value,
        password: this.loginForm.controls.password.value,
      });

      if (!ok) {
        this.loginError.set('Invalid email or password. Please verify and try again.');
        this.loading.set(false);
        return;
      }

      this.successMessage.set('Sign in successful! Entering store...');
      const returnUrl = this.route.snapshot.queryParams['returnUrl'];
      const destination = returnUrl || (this.account.isAdmin() ? '/admin' : '/account');

      setTimeout(() => {
        void this.router.navigateByUrl(destination);
      }, 450);
    } catch (err: any) {
      this.loginError.set(err?.message || 'Unable to sign in. Please try again.');
      this.loading.set(false);
    }
  }

  async submitRegister(): Promise<void> {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    if (this.passwordsMatch() === false) {
      this.registerError.set('Passwords do not match. Please re-enter.');
      return;
    }

    this.loading.set(true);
    this.registerError.set('');
    this.successMessage.set('');

    const { name, email, password } = this.registerForm.getRawValue();

    try {
      const ok = await this.account.register(name, email, password);
      if (!ok) {
        this.registerError.set('Account creation failed. Please try again.');
        this.loading.set(false);
        return;
      }

      this.successMessage.set('Account created! Welcome to Urban Blade Club.');
      const returnUrl = this.route.snapshot.queryParams['returnUrl'];
      const destination = returnUrl || '/account';

      setTimeout(() => {
        void this.router.navigateByUrl(destination);
      }, 500);
    } catch (err: any) {
      this.registerError.set(err?.message || 'Account registration failed. Please try again.');
      this.loading.set(false);
    }
  }
}
