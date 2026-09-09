import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'inr' })
export class InrPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    const amount = value ?? 0;
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  }
}
