import { Injectable, signal } from '@angular/core';

export type StoreTheme = 'light' | 'dark';

const STORAGE_KEY = 'urban-blade-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<StoreTheme>(this.readInitial());

  constructor() {
    this.apply(this.theme());
  }

  toggle(): void {
    this.set(this.theme() === 'dark' ? 'light' : 'dark');
  }

  set(theme: StoreTheme): void {
    this.theme.set(theme);
    this.apply(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }

  private apply(theme: StoreTheme): void {
    const root = document.documentElement;
    root.dataset['theme'] = theme;
    root.style.colorScheme = theme;
  }

  private readInitial(): StoreTheme {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') {
        return stored;
      }
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }
}
