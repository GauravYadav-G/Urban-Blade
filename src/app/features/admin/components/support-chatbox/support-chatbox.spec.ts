import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AdminService } from '@core/services/admin.service';
import type { SupportInquiry } from '@core/models/support.model';
import { SupportChatboxComponent } from './support-chatbox';

describe('Admin support draft recovery', () => {
  let page: SupportChatboxComponent;
  let admin: { supportInquiries: ReturnType<typeof signal<SupportInquiry[]>>; sendInquiryMessage: jasmine.Spy; createInquiry: jasmine.Spy };

  beforeEach(() => {
    admin = {
      supportInquiries: signal([{ id: 'ticket-1', subject: 'Help', messages: [] } as unknown as SupportInquiry]),
      sendInquiryMessage: jasmine.createSpy('sendInquiryMessage'),
      createInquiry: jasmine.createSpy('createInquiry'),
    };
    TestBed.configureTestingModule({ providers: [{ provide: AdminService, useValue: admin }] });
    page = TestBed.runInInjectionContext(() => new SupportChatboxComponent());
  });

  it('retains failed replies and prevents duplicate sends', () => {
    page.replyText.set('Hello');
    page.sendAdminMessage();
    page.sendAdminMessage();
    expect(admin.sendInquiryMessage).toHaveBeenCalledTimes(1);
    expect(page.replyText()).toBe('Hello');
    const args = admin.sendInquiryMessage.calls.mostRecent().args;
    args[4]();
    expect(page.isSending()).toBeFalse();
    expect(page.replyText()).toBe('Hello');
    page.sendAdminMessage();
    admin.sendInquiryMessage.calls.mostRecent().args[3]();
    expect(page.replyText()).toBe('');
  });

  it('does not clear a newer draft when a previous reply finishes', () => {
    page.replyText.set('First reply');
    page.sendAdminMessage();
    page.replyText.set('Next reply');
    admin.sendInquiryMessage.calls.mostRecent().args[3]();
    expect(page.replyText()).toBe('Next reply');
  });

  it('retains the new ticket form after failure and closes it after success', () => {
    page.isNewTicketModalOpen.set(true);
    page.newUserName.set('Customer');
    page.newUserEmail.set('customer@example.com');
    page.newSubject.set('Help');
    page.submitNewTicket();
    page.submitNewTicket();
    expect(admin.createInquiry).toHaveBeenCalledTimes(1);
    admin.createInquiry.calls.mostRecent().args[2]();
    expect(page.isNewTicketModalOpen()).toBeTrue();
    expect(page.newSubject()).toBe('Help');
    expect(page.isCreatingTicket()).toBeFalse();
    page.submitNewTicket();
    admin.createInquiry.calls.mostRecent().args[1]();
    expect(page.isNewTicketModalOpen()).toBeFalse();
    expect(page.newSubject()).toBe('');
  });
});
