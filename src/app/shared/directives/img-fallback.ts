import { Directive, HostListener } from '@angular/core';

@Directive({
  selector: 'img[appImgFallback]',
})
export class ImgFallback {
  @HostListener('error', ['$event'])
  onError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (!img.src.includes('/images/placeholder.svg')) {
      img.src = '/images/placeholder.svg';
    }
  }
}
