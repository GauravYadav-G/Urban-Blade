import { PrintDocumentService } from './print-document.service';

describe('Invoice-only printing', () => {
  let frame: HTMLIFrameElement | undefined;
  let print: jasmine.Spy;
  let account: HTMLElement;
  let paper: HTMLElement;
  beforeEach(() => {
    account = document.createElement('div');
    account.textContent = 'ACCOUNT NAVIGATION AND ORDERS';
    paper = document.createElement('article');
    paper.className = 'receipt';
    paper.setAttribute('_ngcontent-test', '');
    paper.innerHTML = '<header class="receipt-header">INVOICE UB-123</header><table><tr><td>Shampoo</td></tr></table><footer class="receipt-footer">Receipt footer</footer>';
    account.appendChild(paper);
    document.body.appendChild(account);
    const append = document.body.appendChild.bind(document.body);
    spyOn(document.body, 'appendChild').and.callFake(<T extends Node>(node: T): T => {
      const result = append(node);
      if (node instanceof HTMLIFrameElement) {
        frame = node;
        print = spyOn(node.contentWindow!, 'print');
        spyOn(node.contentWindow!, 'focus');
      }
      return result;
    });
  });
  afterEach(() => { account.remove(); frame?.contentWindow?.dispatchEvent(new Event('afterprint')); frame?.remove(); });
  it('prints only the selected document and keeps the website intact', async () => {
    const title = document.title;
    await new PrintDocumentService().print(paper, 'Tax_Invoice_UB-123');
    expect(print).toHaveBeenCalledTimes(1);
    expect(frame!.contentDocument!.body.textContent).toContain('INVOICE UB-123');
    expect(frame!.contentDocument!.body.textContent).not.toContain('ACCOUNT NAVIGATION AND ORDERS');
    expect(frame!.contentDocument!.querySelector('article')!.hasAttribute('_ngcontent-test')).toBeTrue();
    expect(frame!.contentDocument!.title).toBe('Tax_Invoice_UB-123');
    expect(document.title).toBe(title);
    expect(document.body.contains(account)).toBeTrue();
    frame!.contentWindow!.dispatchEvent(new Event('afterprint'));
    expect(frame!.isConnected).toBeFalse();
  });
  it('removes the temporary document if printing fails', async () => {
    // The iframe is initialized synchronously before stylesheet loading is awaited.
    const operation = new PrintDocumentService().print(paper, 'Invoice');
    print.and.throwError('Print unavailable');
    await expectAsync(operation).toBeRejected();
    expect(frame!.isConnected).toBeFalse();
  });
});
