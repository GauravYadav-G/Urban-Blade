import { Component, input } from '@angular/core';

@Component({
  selector: 'app-rating-stars',
  template: `
    <span class="stars" [attr.aria-label]="rating() + ' out of 5 stars'">
      @for (i of [1, 2, 3, 4, 5]; track i) {
        <span [class.stars__on]="i <= Math.round(rating())">★</span>
      }
      @if (count() > 0) {
        <span class="stars__count">{{ count() }}</span>
      }
    </span>
  `,
  styles: `
    .stars {
      display: inline-flex;
      align-items: center;
      gap: 0.1rem;
      color: #ccc;
      font-size: 0.9rem;
    }
    .stars__on {
      color: var(--star);
    }
    .stars__count {
      margin-left: 0.3rem;
      color: var(--link);
      font-size: 0.8rem;
    }
  `,
})
export class RatingStars {
  readonly rating = input(0);
  readonly count = input(0);
  protected readonly Math = Math;
}
