import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AccountService } from '@core/services/account.service';

@Component({
  selector: 'app-register-page',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <section class="panel">
      <p class="panel__kicker">Join Urban Blade</p>
      <h1>Create account</h1>
      <p class="panel__lede">Save your cart, track orders, and book salon visits in Ghaziabad.</p>
      <form [formGroup]="form" (ngSubmit)="submit()">
        <label>Your name <input formControlName="name" autocomplete="name" placeholder="Full name" /></label>
        <label>Email <input type="email" formControlName="email" autocomplete="email" placeholder="you@email.com" /></label>
        <label>Password <input type="password" formControlName="password" autocomplete="new-password" placeholder="At least 4 characters" /></label>
        <button type="submit">Create account</button>
      </form>
      <p class="panel__foot">Already have an account? <a routerLink="/auth/login">Sign in</a></p>
    </section>
  `,
  styleUrl: '../login-page/login-page.scss',
})
export class RegisterPage {
  private readonly fb = inject(FormBuilder);
  private readonly account = inject(AccountService);
  private readonly router = inject(Router);

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(4)]],
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { name, email } = this.form.getRawValue();
    this.account.register(name, email);
    void this.router.navigate(['/account']);
  }
}
