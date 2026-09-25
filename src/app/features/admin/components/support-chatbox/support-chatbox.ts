import { Component, inject, signal, computed, output, OnInit, OnDestroy, ViewChild, ElementRef, afterNextRender } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../../core/services/admin.service';
import { SupportInquiry } from '../../../../core/models/support.model';

@Component({
  selector: 'app-support-chatbox',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './support-chatbox.html',
  styleUrls: ['./support-chatbox.scss'],
})
export class SupportChatboxComponent implements OnInit, OnDestroy {
  admin = inject(AdminService);
  close = output<void>();

  @ViewChild('messagesViewport') private messagesViewport?: ElementRef<HTMLDivElement>;

  selectedInquiryId = signal<string | null>(null);
  filterStatus = signal<'all' | 'open' | 'ai_resolved' | 'escalated' | 'closed'>('all');
  searchQuery = signal<string>('');
  aiAutoPilot = signal<boolean>(true);
  isGeneratingAi = signal<boolean>(false);
  isRefreshing = signal<boolean>(false);
  replyText = signal<string>('');

  // New Ticket Modal State
  isNewTicketModalOpen = signal<boolean>(false);
  newUserName = signal<string>('');
  newUserEmail = signal<string>('');
  newSubject = signal<string>('');
  newOrderId = signal<string>('');
  newPriority = signal<'low' | 'medium' | 'high'>('medium');
  newInitialMessage = signal<string>('');

  private syncTimer: any = null;
  private lastMessageCount = 0;

  filteredInquiries = computed(() => {
    let list = this.admin.supportInquiries();
    const filter = this.filterStatus();
    const q = this.searchQuery().toLowerCase().trim();

    if (filter !== 'all') {
      list = list.filter((i) => i.status === filter);
    }

    if (q) {
      list = list.filter(
        (i) =>
          i.user_name.toLowerCase().includes(q) ||
          i.user_email.toLowerCase().includes(q) ||
          i.subject.toLowerCase().includes(q) ||
          (i.order_id && i.order_id.toLowerCase().includes(q))
      );
    }

    return list;
  });

  selectedInquiry = computed<SupportInquiry | null>(() => {
    const list = this.admin.supportInquiries();
    const id = this.selectedInquiryId();
    if (id) {
      const match = list.find((i) => i.id === id);
      if (match) return match;
    }
    const filtered = this.filteredInquiries();
    return filtered.length > 0 ? filtered[0] : list.length > 0 ? list[0] : null;
  });

  unreadEscalatedCount = computed(() => {
    return this.admin.supportInquiries().filter((i) => i.status === 'escalated').length;
  });

  ngOnInit(): void {
    this.refreshLiveInquiries();

    // Start aggressive real-time polling while support window is open
    this.syncTimer = setInterval(() => {
      this.admin.refreshInquiries(false);
      this.checkAndScroll();
    }, 2500);
  }

  ngOnDestroy(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
  }

  refreshLiveInquiries(): void {
    this.isRefreshing.set(true);
    this.admin.refreshInquiries(true);
    setTimeout(() => {
      this.isRefreshing.set(false);
      const inq = this.selectedInquiry();
      if (inq && !this.selectedInquiryId()) {
        this.selectedInquiryId.set(inq.id);
      }
      this.scrollToBottom();
    }, 400);
  }

  selectInquiry(id: string): void {
    this.selectedInquiryId.set(id);
    this.replyText.set('');
    setTimeout(() => this.scrollToBottom(), 50);
  }

  sendAdminMessage(): void {
    const text = this.replyText().trim();
    const inquiry = this.selectedInquiry();
    if (!text || !inquiry) return;

    this.admin.sendInquiryMessage(inquiry.id, text, 'admin');
    this.replyText.set('');
    setTimeout(() => this.scrollToBottom(), 100);
  }

  triggerAiReply(customPrompt?: string): void {
    const inquiry = this.selectedInquiry();
    if (!inquiry || this.isGeneratingAi()) return;

    const prompt = customPrompt || inquiry.messages[inquiry.messages.length - 1]?.text || inquiry.subject;
    this.isGeneratingAi.set(true);

    this.admin
      .queryAiChatbot({
        message: prompt,
        orderId: inquiry.order_id || undefined,
        inquiryId: inquiry.id,
        customerName: inquiry.user_name,
        vendorName: inquiry.vendor_name || undefined,
      })
      .subscribe({
        next: (res) => {
          this.isGeneratingAi.set(false);
          if (res && res.reply) {
            this.admin.sendInquiryMessage(inquiry.id, res.reply, 'ai');
            if (inquiry.status === 'open') {
              this.admin.updateInquiryStatus(inquiry.id, 'ai_resolved');
            }
            setTimeout(() => this.scrollToBottom(), 100);
          }
        },
        error: () => {
          this.isGeneratingAi.set(false);
        },
      });
  }

  draftAiReply(): void {
    const inquiry = this.selectedInquiry();
    if (!inquiry || this.isGeneratingAi()) return;

    const lastMsg = inquiry.messages[inquiry.messages.length - 1]?.text || inquiry.subject;
    this.isGeneratingAi.set(true);

    this.admin
      .queryAiChatbot({
        message: lastMsg,
        orderId: inquiry.order_id || undefined,
        inquiryId: inquiry.id,
        customerName: inquiry.user_name,
        vendorName: inquiry.vendor_name || undefined,
      })
      .subscribe({
        next: (res) => {
          this.isGeneratingAi.set(false);
          if (res && res.reply) {
            this.replyText.set(res.reply);
          }
        },
        error: () => {
          this.isGeneratingAi.set(false);
        },
      });
  }

  changeStatus(inquiryId: string, status: SupportInquiry['status']): void {
    this.admin.updateInquiryStatus(inquiryId, status);
  }

  deleteInquiry(inquiryId: string): void {
    if (confirm('Are you sure you want to permanently delete this inquiry from the PostgreSQL database?')) {
      this.admin.deleteInquiry(inquiryId);
      this.selectedInquiryId.set(null);
    }
  }

  quickAction(action: string): void {
    if (action === 'track') {
      this.triggerAiReply('Please provide live courier tracking update, dispatch warehouse checkpoint, and estimated delivery time for my order.');
    } else if (action === 'policy') {
      this.triggerAiReply('What is the return, replacement, and warranty policy for Urban Blade grooming products?');
    } else if (action === 'stylist') {
      this.triggerAiReply('How do I book or reschedule an in-salon master barber appointment?');
    }
  }

  submitNewTicket(): void {
    const name = this.newUserName().trim();
    const email = this.newUserEmail().trim();
    const subject = this.newSubject().trim();
    if (!name || !email || !subject) return;

    this.admin.createInquiry({
      userName: name,
      userEmail: email,
      subject,
      orderId: this.newOrderId().trim() || undefined,
      priority: this.newPriority(),
      initialMessage: this.newInitialMessage().trim() || undefined,
    });

    this.isNewTicketModalOpen.set(false);
    this.newUserName.set('');
    this.newUserEmail.set('');
    this.newSubject.set('');
    this.newOrderId.set('');
    this.newInitialMessage.set('');
  }

  handleEnterKey(event: Event): void {
    const e = event as KeyboardEvent;
    if (e.ctrlKey || e.metaKey) {
      this.sendAdminMessage();
    }
  }

  private checkAndScroll(): void {
    const inq = this.selectedInquiry();
    const currentCount = inq?.messages?.length || 0;
    if (currentCount > this.lastMessageCount) {
      this.lastMessageCount = currentCount;
      this.scrollToBottom();
    }
  }

  private scrollToBottom(): void {
    try {
      if (this.messagesViewport?.nativeElement) {
        this.messagesViewport.nativeElement.scrollTop = this.messagesViewport.nativeElement.scrollHeight;
      }
    } catch {}
  }

  onClose(): void {
    this.close.emit();
  }
}
