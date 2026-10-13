import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PrintDocumentService {
  async print(element: HTMLElement, title: string): Promise<void> {
    const frame = document.createElement('iframe');
    frame.title = 'Printable order document';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;';
    document.body.appendChild(frame);
    const target = frame.contentDocument;
    const printWindow = frame.contentWindow;
    if (!target || !printWindow) { frame.remove(); throw new Error('Print preview is unavailable.'); }
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { clearTimeout(cleanupTimer); frame.remove(); };
    try {
      target.title = title;
      const base = target.createElement('base');
      base.href = document.baseURI;
      target.head.appendChild(base);
      const styles = Array.from(document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>('style, link[rel="stylesheet"]'));
      await Promise.all(styles.map(source => new Promise<void>((resolve, reject) => {
        const clone = source.cloneNode(true) as HTMLStyleElement | HTMLLinkElement;
        if (clone instanceof HTMLLinkElement) {
          clone.href = (source as HTMLLinkElement).href;
          clone.onload = () => resolve();
          clone.onerror = () => reject(new Error('Receipt styles could not be loaded. Please retry.'));
        }
        target.head.appendChild(clone);
        if (!(clone instanceof HTMLLinkElement)) resolve();
      })));
      target.body.appendChild(element.cloneNode(true));
      await target.fonts.ready;
      printWindow.addEventListener('afterprint', cleanup, { once: true });
      cleanupTimer = setTimeout(cleanup, 120_000);
      printWindow.focus();
      printWindow.print();
    } catch (error) { cleanup(); throw error; }
  }
}
