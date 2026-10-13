import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { AdminService } from './admin.service';
import { AccountService } from './account.service';
import { CatalogService } from './catalog.service';
import { ToastService } from './toast.service';
import type { SupportInquiry } from '../models/support.model';

describe('Admin API integration regressions', () => {
  let admin: AdminService;
  let http: HttpTestingController;
  let toast: { error: jasmine.Spy; success: jasmine.Spy; info: jasmine.Spy };
  const inquiry: SupportInquiry = {
    id: 'ticket-1', user_name: 'Customer', user_email: 'customer@example.com',
    subject: 'Delivery', status: 'open', priority: 'medium', messages: [],
    created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z',
  };

  beforeEach(() => {
    toast = { error: jasmine.createSpy('error'), success: jasmine.createSpy('success'), info: jasmine.createSpy('info') };
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: AccountService, useValue: { user: signal(null), isAdmin: () => true, isVendor: () => false } },
      { provide: CatalogService, useValue: {} },
      { provide: ToastService, useValue: toast },
    ] });
    admin = TestBed.inject(AdminService);
    http = TestBed.inject(HttpTestingController);
    TestBed.tick();
    admin.supportInquiries.set([inquiry]);
  });

  afterEach(() => http.verify());

  it('polls the staff endpoint and repairs a deleted active selection', () => {
    admin.activeSupportInquiryId.set('deleted');
    admin.refreshInquiries();
    http.expectOne(request => request.url.endsWith('/api/admin/support/inquiries')).flush({ data: [inquiry] });
    expect(admin.activeSupportInquiryId()).toBe(inquiry.id);
  });

  it('does not show a failed reply as delivered', () => {
    const saved = jasmine.createSpy('saved');
    const complete = jasmine.createSpy('complete');
    admin.sendInquiryMessage(inquiry.id, 'Hello', 'admin', saved, complete);
    const request = http.expectOne(request => request.url.endsWith('/api/admin/support/inquiries/ticket-1/message'));
    expect(request.request.body).toEqual({ text: 'Hello', sender: 'admin' });
    expect(admin.supportInquiries()[0].messages).toEqual([]);
    request.flush({}, { status: 503, statusText: 'Unavailable' });
    expect(saved).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(admin.supportInquiries()[0]).toEqual(inquiry);
  });

  it('applies server-confirmed replies', () => {
    const saved = jasmine.createSpy('saved');
    const persisted = { ...inquiry, messages: [{ id: 'message-1', sender: 'admin', text: 'Hello', timestamp: inquiry.created_at }] };
    admin.sendInquiryMessage(inquiry.id, 'Hello', 'admin', saved);
    http.expectOne(request => request.url.endsWith('/message')).flush({ ok: true, inquiry: persisted });
    expect(admin.supportInquiries()[0].messages.length).toBe(1);
    expect(saved).toHaveBeenCalled();
  });

  it('keeps the original status when saving fails', () => {
    admin.updateInquiryStatus(inquiry.id, 'closed');
    http.expectOne(request => request.url.endsWith('/api/admin/support/inquiries/ticket-1/status'))
      .flush({}, { status: 503, statusText: 'Unavailable' });
    expect(admin.supportInquiries()[0].status).toBe('open');
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('finishes failed ticket creation without calling the saved callback', () => {
    const saved = jasmine.createSpy('saved');
    const complete = jasmine.createSpy('complete');
    admin.createInquiry({ userName: 'Customer', userEmail: inquiry.user_email, subject: 'Help' }, saved, complete);
    http.expectOne(request => request.url.endsWith('/api/admin/support/inquiries'))
      .flush({}, { status: 503, statusText: 'Unavailable' });
    expect(saved).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalled();
  });

  it('sends AI requests through the staff route', () => {
    admin.queryAiChatbot({ message: 'Help', inquiryId: inquiry.id }).subscribe();
    http.expectOne(request => request.url.endsWith('/api/admin/support/ai-chat')).flush({ ok: true, reply: 'Hello' });
  });

  it('preserves task due dates and customer links using the server field names', () => {
    admin.addTask({ title: 'Call customer', due_date: 'Tomorrow', related_user: 'Customer' });
    const request = http.expectOne(request => request.url.endsWith('/api/admin/tasks'));
    expect(request.request.body.dueDate).toBe('Tomorrow');
    expect(request.request.body.relatedUser).toBe('Customer');
    request.flush({ ok: true, task: { ...admin.adminTasks()[0], id: 'persisted-task' } });
    expect(admin.adminTasks()[0].id).toBe('persisted-task');
  });
});
