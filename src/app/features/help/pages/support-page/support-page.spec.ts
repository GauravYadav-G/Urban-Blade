import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AccountService } from '@core/services/account.service';
import { CartService } from '@core/services/cart.service';
import { SupportPage } from './support-page';

describe('Support page failure states', () => {
  let page: SupportPage;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(),
      { provide: AccountService, useValue: { user: () => null } },
      { provide: CartService, useValue: {} }, { provide: Router, useValue: {} },
    ] });
    http = TestBed.inject(HttpTestingController);
    page = TestBed.runInInjectionContext(() => new SupportPage());
  });
  afterEach(() => http.verify());
  it('keeps failed chat sends available for retry', () => {
    page.sendChatMessage('Help with my order');
    http.expectOne('/api/support/ai-chat').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(page.chatMessages().length).toBe(2);
    expect(page.chatError()).toContain('could not be sent');
    page.retryChatMessage();
    expect(page.chatMessages().filter(message => message.sender === 'user').length).toBe(1);
    http.expectOne('/api/support/ai-chat').flush({ ok: true, reply: 'How can I help?' });
    expect(page.chatError()).toBe('');
  });
  it('keeps the ticket form intact and does not report success after a failure', () => {
    page.openTicketModal();
    page.ticketForm.patchValue({ userName: 'Alex', userEmail: 'alex@example.invalid', subject: 'Order help', message: 'Please help with my order.' });
    page.submitTicket();
    http.expectOne('/api/support/inquiries').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(page.ticketModalOpen()).toBeTrue();
    expect(page.ticketSuccessMessage()).toBe('');
    expect(page.ticketError()).toContain('not submitted');
    expect(page.ticketForm.controls.message.value).toBe('Please help with my order.');
    expect(page.isSubmittingTicket()).toBeFalse();
  });
});
