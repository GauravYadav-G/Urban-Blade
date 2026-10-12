import { AfterViewInit, Directive, ElementRef, inject, OnDestroy } from '@angular/core';

/** Native modality supplies focus containment, background inertness and Escape handling. */
@Directive({ selector: 'dialog[appAdminDialog]', standalone: true })
export class AdminDialog implements AfterViewInit, OnDestroy {
  private readonly element = inject(ElementRef<HTMLDialogElement>).nativeElement;
  private previousFocus: HTMLElement | null = null;

  ngAfterViewInit(): void {
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.element.showModal();
  }

  ngOnDestroy(): void {
    this.element.close();
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }
}
