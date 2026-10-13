import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AccountService } from '@core/services/account.service';
import { CartService } from '@core/services/cart.service';
import { FloatingAiChatComponent } from './floating-ai-chat';

describe('Concierge chat states', () => {
  let chat: FloatingAiChatComponent;
  let http: HttpTestingController;
  let originalId: string | null;
  beforeEach(() => {
    originalId = localStorage.getItem('urban_active_inquiry_id');
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(),
      { provide: AccountService, useValue: { user: () => null } },
      { provide: CartService, useValue: {} },
      { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
    ] });
    http = TestBed.inject(HttpTestingController);
    chat = TestBed.runInInjectionContext(() => new FloatingAiChatComponent());
  });
  afterEach(() => {
    http.verify(); chat.ngOnDestroy();
    if (originalId === null) localStorage.removeItem('urban_active_inquiry_id');
    else localStorage.setItem('urban_active_inquiry_id', originalId);
  });
  it('shows a retry state without inventing an AI reply', () => {
    chat.sendMessage('What are your prices?');
    http.expectOne('/api/support/live-chat/message').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(chat.messages().length).toBe(2);
    expect(chat.messages()[1].sender).toBe('user');
    expect(chat.chatError()).toContain('could not be sent');
    expect(chat.isGenerating()).toBeFalse();
  });
  it('retries a failed message without duplicating it in the conversation', () => {
    chat.sendMessage('Help with my order');
    http.expectOne('/api/support/live-chat/message').flush({}, { status: 503, statusText: 'Unavailable' });
    chat.retryMessage();
    const request = http.expectOne('/api/support/live-chat/message');
    expect(request.request.body.message).toBe('Help with my order');
    expect(chat.messages().filter(message => message.sender === 'user').length).toBe(1);
    request.flush({ ok: true, inquiryId: 'ticket-1', messages: chat.messages(), reply: 'How can I help?' });
    expect(chat.chatError()).toBe('');
  });
  it('preserves conversation history during a temporary sync failure', () => {
    chat.inquiryId.set('ticket-1');
    const history = chat.messages();
    chat.fetchLatestInquiry('ticket-1');
    http.expectOne('/api/support/inquiries/ticket-1').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(chat.inquiryId()).toBe('ticket-1');
    expect(chat.messages()).toEqual(history);
    expect(chat.connectionState()).toBe('reconnecting');
  });
  it('preserves conversation history if deletion fails', () => {
    chat.inquiryId.set('ticket-1');
    spyOn(window, 'confirm').and.returnValue(true);
    chat.clearChat();
    http.expectOne('/api/support/inquiries/ticket-1').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(chat.inquiryId()).toBe('ticket-1');
    expect(chat.resettingChat()).toBeFalse();
    expect(chat.chatError()).toContain('could not be cleared');
  });
  it('keeps Shift+Enter and IME Enter available for composition', () => {
    const send = spyOn(chat, 'sendMessage');
    chat.onComposerKeydown(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    chat.onComposerKeydown(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
    expect(send).not.toHaveBeenCalled();
    chat.onComposerKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(send).toHaveBeenCalledTimes(1);
  });
});
