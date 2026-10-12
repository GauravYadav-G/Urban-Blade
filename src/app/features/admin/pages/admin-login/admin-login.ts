import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AccountService } from '@core/services/account.service';

@Component({
  selector: 'app-admin-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './admin-login.html',
  styleUrl: './admin-login.scss',
})
export class AdminLogin {
  private readonly fb = inject(FormBuilder);
  private readonly account = inject(AccountService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly showPassword = signal(false);
  readonly errorMessage = signal('');
  readonly isSubmitting = signal(false);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(4)]],
  });

  togglePassword(): void {
    this.showPassword.update((val) => !val);
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set('');

    const values = this.form.getRawValue();
    const success = await this.account.adminSignIn(values);

    if (!success) {
      this.isSubmitting.set(false);
      this.errorMessage.set(
        'Invalid administrator credentials. Access restricted to authorized personnel only.'
      );
      return;
    }

    const returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/admin/dashboard';
    void this.router.navigateByUrl(returnUrl);
  }
}
