import { Component, inject, signal, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AccountService } from '@core/services/account.service';
import { CartService } from '@core/services/cart.service';
import type { ChatMessage, ChatOperationPayload, ChatActionChip } from '@core/models/support.model';
import type { Product } from '@core/models/product.model';

export interface BookingFormState {
  serviceId: string;
  serviceName: string;
  price: number;
  stylistId: string;
  stylistName: string;
  stylistAvatar?: string;
  dateStr: string;
  timeSlot: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
}

export interface ConfirmedBookingTicket {
  bookingId: string;
  serviceName: string;
  price: number;
  stylistName: string;
  stylistAvatar?: string;
  dateStr: string;
  timeSlot: string;
  customerName: string;
  venue: string;
  hotline: string;
  confirmedAt: string;
}

@Component({
  selector: 'app-floating-ai-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './floating-ai-chat.html',
  styleUrls: ['./floating-ai-chat.scss'],
})
export class FloatingAiChatComponent implements OnInit, OnDestroy {
  @ViewChild('messagesViewport') private messagesViewport?: ElementRef<HTMLDivElement>;

  protected readonly account = inject(AccountService);
  private readonly cartService = inject(CartService);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);

  readonly isOpen = signal<boolean>(false);
  readonly inquiryId = signal<string | null>(null);
  readonly isGenerating = signal<boolean>(false);
  readonly inputText = signal<string>('');
  inputValue = ''; // Plain property for reliable ngModel two-way binding
  readonly unreadAdminCount = signal<number>(0);
  readonly addedProductIds = signal<Set<string>>(new Set<string>());

  // Interactive In-Chat Salon Booking State
  readonly activeBookingForm = signal<{ [msgId: string]: BookingFormState }>({});
  readonly confirmedBookings = signal<{ [msgId: string]: ConfirmedBookingTicket }>({});
  readonly isSubmittingBooking = signal<{ [msgId: string]: boolean }>({});
  readonly bookingError = signal<{ [msgId: string]: string | null }>({});

  readonly dateOptions = signal<Array<{ label: string; dateStr: string; dayName: string }>>([]);
  readonly slotOptions = signal<string[]>([
    '09:30 AM',
    '11:00 AM',
    '12:30 PM',
    '02:30 PM',
    '04:00 PM',
    '05:30 PM',
    '07:00 PM',
    '08:30 PM',
  ]);

  readonly messages = signal<ChatMessage[]>(this.getInitialWelcomeMessages());

  readonly quickChips: ChatActionChip[] = [
    { label: '✂️ Reserve Chair', query: 'Book appointment' },
    { label: '💈 Haircut Rates', query: 'What are your haircut prices?' },
    { label: '📦 Track Order', query: 'Where is my order?' },
    { label: '📍 Studio Location', query: 'Where is your studio located?' },
    { label: '🌿 Hair Fall Care', query: 'What should I do for hair fall?' },
    { label: '🧔 Beard Density', query: 'How to fix a patchy beard?' },
    { label: '🚚 Shipping Policy', query: 'What are the shipping charges?' },
    { label: '🛡️ 7-Day Guarantee', query: 'What is the return and warranty policy?' },
  ];

  private pollInterval: any = null;
  private broadcastChannel: BroadcastChannel | null = null;

  private getInitialWelcomeMessages(): ChatMessage[] {
    return [
      {
        id: 'init',
        sender: 'ai',
        text: `Hi there! How can I help you today? You can book a salon chair, track an order, or ask any questions about our products.`,
        timestamp: new Date().toISOString(),
        actionChips: [
          { label: '✂️ Reserve Barber Chair', query: 'Book appointment' },
          { label: '💈 Haircut Menu & Rates', query: 'What are your haircut prices?' },
          { label: '📦 Live Order Tracking', query: 'Where is my order?' },
          { label: '📍 Studio Location & Hours', query: 'Where is your studio located?' },
          { label: '🌿 Hair Fall Protocol', query: 'What do I do for hair fall?' },
          { label: '🧔 Patchy Beard Guide', query: 'How to fix a patchy beard?' },
        ],
      },
    ];
  }

  ngOnInit(): void {
    // Generate next 5 calendar dates for in-chat booking
    const dates: Array<{ label: string; dateStr: string; dayName: string }> = [];
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    for (let i = 0; i < 5; i++) {
      const d = new Date(Date.now() + i * 24 * 3600 * 1000);
      const dateStr = d.toISOString().split('T')[0];
      const dayName = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : days[d.getDay()];
      const label = `${dayName} (${d.getDate()} ${months[d.getMonth()]})`;
      dates.push({ label, dateStr, dayName });
    }
    this.dateOptions.set(dates);

    const savedId = localStorage.getItem('urban_active_inquiry_id');
    if (savedId) {
      this.inquiryId.set(savedId);
      this.fetchLatestInquiry(savedId);
    }

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.broadcastChannel = new BroadcastChannel('urban_support_bus');
      this.broadcastChannel.onmessage = (event) => {
        const id = this.inquiryId();
        if (event.data?.type === 'INQUIRY_DELETED') {
          if (id && (event.data.ids?.includes(id) || event.data.inquiryId === id)) {
            localStorage.removeItem('urban_active_inquiry_id');
            this.inquiryId.set(null);
            this.messages.set(this.getInitialWelcomeMessages());
          }
        } else if (id && (!event.data?.inquiryId || event.data.inquiryId === id)) {
          this.fetchLatestInquiry(id);
        }
      };
    }

    // Background sync with database every 2.5 seconds
    this.pollInterval = setInterval(() => {
      const id = this.inquiryId();
      if (id && !this.isGenerating()) {
        this.fetchLatestInquiry(id);
      }
    }, 2500);
  }

  ngOnDestroy(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.broadcastChannel) this.broadcastChannel.close();
  }

  toggleOpen(): void {
    const nextState = !this.isOpen();
    this.isOpen.set(nextState);
    if (nextState) {
      this.unreadAdminCount.set(0);
      const id = this.inquiryId();
      if (id) {
        this.fetchLatestInquiry(id);
      }
      this.scrollToBottom('auto');
    }
  }

  scrollToBottom(behavior: ScrollBehavior = 'smooth'): void {
    if (typeof window === 'undefined') return;
    setTimeout(() => {
      const el = this.messagesViewport?.nativeElement;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior });
      }
    }, 60);
  }

  formatMessage(text: string): SafeHtml {
    if (!text) return '';
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Bold **text** -> <strong>text</strong>
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Bullet lines: • or * or - at start of line
    escaped = escaped.replace(/^[•\-\*]\s*(.+)$/gm, '<li class="chat-li">$1</li>');
    // Wrap groups of <li> in <ul class="chat-ul">
    escaped = escaped.replace(/((?:<li class="chat-li">.*?<\/li>\s*)+)/gs, '<ul class="chat-ul">$1</ul>');
    // Double newlines to paragraph break
    escaped = escaped.replace(/\n\n+/g, '<div class="chat-para-break"></div>');
    // Single newlines to <br> if not inside ul or break
    escaped = escaped.replace(/\n/g, '<br/>');

    return this.sanitizer.bypassSecurityTrustHtml(escaped);
  }

  fetchLatestInquiry(id: string): void {
    if (this.isGenerating()) return;

    this.http
      .get<{ data: { id: string; messages: ChatMessage[]; status: string } | null; notFound?: boolean }>(
        `/api/support/inquiries/${id}`
      )
      .subscribe({
        next: (res) => {
          if (res?.notFound || !res?.data) {
            localStorage.removeItem('urban_active_inquiry_id');
            this.inquiryId.set(null);
            this.messages.set(this.getInitialWelcomeMessages());
            return;
          }

          if (this.isGenerating()) return;

          if (res?.data?.messages && Array.isArray(res.data.messages)) {
            const newMsgs = res.data.messages;
            const currentMsgs = this.messages();

            const isDiff =
              newMsgs.length !== currentMsgs.length ||
              (newMsgs.length > 0 && newMsgs[newMsgs.length - 1]?.id !== currentMsgs[currentMsgs.length - 1]?.id);

            if (isDiff) {
              if (!this.isOpen() && newMsgs.length > currentMsgs.length) {
                const hasNewAdminMsg = newMsgs.slice(currentMsgs.length).some((m) => m.sender === 'admin');
                if (hasNewAdminMsg) {
                  this.unreadAdminCount.update((c) => c + 1);
                }
              }

              this.messages.set(newMsgs);
              this.scrollToBottom('smooth');
            }
          }
        },
        error: () => {
          localStorage.removeItem('urban_active_inquiry_id');
          this.inquiryId.set(null);
          this.messages.set(this.getInitialWelcomeMessages());
        },
      });
  }

  clearChat(): void {
    if (!confirm('Permanently delete and reset this chat conversation?')) return;
    const currentId = this.inquiryId();
    if (currentId) {
      this.http.delete(`/api/support/inquiries/${currentId}`).subscribe({
        next: () => {},
        error: () => {},
      });
    }
    localStorage.removeItem('urban_active_inquiry_id');
    this.inquiryId.set(null);
    this.messages.set(this.getInitialWelcomeMessages());
    this.activeBookingForm.set({});
    this.confirmedBookings.set({});
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({ type: 'USER_QUERY', deletedInquiryId: currentId });
    }
  }

  sendMessage(customText?: string): void {
    const text = (customText || this.inputValue || this.inputText()).trim();
    if (!text || this.isGenerating()) return;

    if (!customText) {
      this.inputValue = '';
      this.inputText.set('');
    }

    const optimisticUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date().toISOString(),
    };

    this.messages.update((list) => [...list, optimisticUserMsg]);
    this.isGenerating.set(true);
    this.scrollToBottom('smooth');

    const user = this.account.user();
    const payload = {
      inquiryId: this.inquiryId() || undefined,
      userName: user?.name || 'Valued Guest',
      userEmail: user?.email || 'guest@urbanblade.in',
      message: text,
    };

    this.http
      .post<{ ok: boolean; inquiryId: string; messages: ChatMessage[]; reply: string }>(
        '/api/support/live-chat/message',
        payload
      )
      .subscribe({
        next: (res) => {
          this.isGenerating.set(false);
          if (res.inquiryId) {
            this.inquiryId.set(res.inquiryId);
            localStorage.setItem('urban_active_inquiry_id', res.inquiryId);
          }
          if (res.messages && Array.isArray(res.messages)) {
            this.messages.set(res.messages);
          }
          this.scrollToBottom('smooth');
          if (this.broadcastChannel) {
            this.broadcastChannel.postMessage({ type: 'USER_QUERY', inquiryId: res.inquiryId });
          }
        },
        error: async () => {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 4500);
            const directRes = await fetch('https://text.pollinations.ai/', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messages: [
                  {
                    role: 'system',
                    content:
                      'You are Urban AI concierge for Urban Blade luxury barbershop (Sector 63 Noida, 7 AM-11 PM daily). Answer under 70 words with master barber polish. If user greets, reply warmly without dumping products.',
                  },
                  { role: 'user', content: text },
                ],
                model: 'openai',
              }),
              signal: controller.signal,
            });
            clearTimeout(timer);

            if (directRes.ok) {
              const aiText = await directRes.text();
              if (aiText && !aiText.includes('<!DOCTYPE html>') && !aiText.includes('Bad gateway') && !aiText.includes('Cloudflare')) {
                this.isGenerating.set(false);
                this.messages.update((list) => [
                  ...list,
                  {
                    id: `ai-direct-${Date.now()}`,
                    sender: 'ai',
                    text: aiText.trim(),
                    timestamp: new Date().toISOString(),
                    actionChips: [
                      { label: '✂️ Reserve Barber Chair', query: 'Book appointment' },
                      { label: '💈 Haircut Menu & Rates', query: 'What are your haircut prices?' },
                      { label: '📦 Live Order Tracking', query: 'Where is my order?' },
                      { label: '✨ Shop Bestsellers', query: 'Show bestsellers' },
                    ],
                  },
                ]);
                this.scrollToBottom('smooth');
                return;
              }
            }
          } catch {}

          this.isGenerating.set(false);
          const tLower = text.toLowerCase();
          const isGreeting =
            tLower.startsWith('namaste') ||
            tLower.startsWith('namste') ||
            tLower.startsWith('hi') ||
            tLower.startsWith('hello') ||
            tLower.startsWith('hey') ||
            tLower.includes('kaise ho') ||
            tLower.includes('kesa ho') ||
            tLower.includes('kese ho') ||
            tLower.includes('kaisa hai') ||
            tLower.includes('how are you');

          const isHindi =
            tLower.includes('namaste') ||
            tLower.includes('kesa') ||
            tLower.includes('kaise') ||
            tLower.includes('app') ||
            tLower.includes('aap') ||
            tLower.includes('mujhe') ||
            tLower.includes('kuch') ||
            tLower.includes('dekka') ||
            tLower.includes('dikha') ||
            tLower.includes('chahiye') ||
            tLower.includes('batao') ||
            tLower.includes('chehra');
          const isFace = tLower.includes('face') || tLower.includes('skin') || tLower.includes('chehra') || tLower.includes('chehre') || tLower.includes('tan') || tLower.includes('glow') || tLower.includes('wash');

          let smartFallback = isHindi
            ? `Namaste! Main Urban Blade salon concierge hoon. Aap hair care, beard styling, skincare products ya appointment booking ke baare mein pooch sakte hain!`
            : `Hello! I am Urban Blade Concierge. How can I assist you today with styling advice, grooming products, or reserving a barber chair?`;

          if (isGreeting) {
            smartFallback = isHindi
              ? `Namaste! Main bilkul badhiya hoon, aap bataiye aap kaise hain? Urban Blade mein aapka swagat hai. Aaj main aapki styling, hair care products ya salon chair booking mein kya madad kar sakta hoon?`
              : `Hello! I'm doing great, thank you for asking. Welcome to Urban Blade! How can I assist you today with styling advice, grooming products, or reserving a barber chair?`;
          } else if (isFace) {
            smartFallback = isHindi
              ? `✨ **Urban Blade Face & Skin Care Guide:**\n\nChehre ke liye hamare Master Barbers yeh best salon formulations recommend karte hain:\n\n• **Charcoal Face Wash (₹349)**: Deep pore cleansing ke liye, extra oil aur pollution hatata hai.\n• **De-Tan Home Kit (₹899)**: Dhoop aur sun-tan hatane ke liye 3-step salon facial sequence.\n• **Men's SPA Package (₹1499)**: 90-minute complete facial, massage aur hair care.\n\nAap inhein direct cart mein add kar sakte hain ya salon session book kar sakte hain!`
              : `✨ **Urban Blade Face & Skin Care Formulations:**\n\nFor healthy, radiant skin, our Master Barbers recommend:\n\n• **Charcoal Face Wash (₹349)**: Activated charcoal & tea tree for deep pore detox and oil control.\n• **De-Tan Home Kit (₹899)**: 3-step salon facial sequence to eliminate sun damage.\n• **Men's SPA Package (₹1499)**: Complete 90-minute in-chair facial and head therapy.`;
          } else if (tLower.includes('beard') || tLower.includes('daadi')) {
            smartFallback = isHindi
              ? `🧔 **Beard Care Guide:**\n\nDaadi ki growth aur styling ke liye hamare Master Barbers **Beard Oil (₹449)** aur **In-Studio Beard Sculpting (₹199)** recommend karte hain!`
              : `🧔 For beard grooming and growth, we recommend our Organic Beard Growth Oil (₹399) and Shea Beard Butter (₹449), plus in-studio Beard Sculpting (₹199) with hot steam towels.`;
          } else if (tLower.includes('book') || tLower.includes('haircut') || tLower.includes('appointment')) {
            smartFallback = `✂️ You can reserve a chair at our Flagship Studio in Sector 63, Noida (open 7 AM – 11 PM daily) for Men's Precision Haircut (₹249) or Master Cut with Vikram Sharma (₹499).`;
          } else if (tLower.includes('order') || tLower.includes('track')) {
            smartFallback = `📦 I can check your order tracking right away! Share your Order ID or registered email, and I'll pull live carrier checkpoints.`;
          }

          this.messages.update((list) => [
            ...list,
            {
              id: `ai-fb-${Date.now()}`,
              sender: 'ai',
              text: smartFallback,
              timestamp: new Date().toISOString(),
              actionChips: [
                { label: '✂️ Reserve Barber Chair', query: 'Book appointment' },
                { label: '💈 Haircut Menu & Rates', query: 'What are your haircut prices?' },
                { label: '📦 Live Order Tracking', query: 'Where is my order?' },
              ],
            },
          ]);
          this.scrollToBottom('smooth');
        },
      });
  }

  // ─── IN-CHAT SALON CHAIR BOOKING METHODS ────────────────────────────────────

  /** Called from template — MUST be pure/read-only, no signal writes allowed during render */
  getBookingState(msgId: string, bookingData: any): BookingFormState {
    const current = this.activeBookingForm()[msgId];
    if (current) return current;

    // Not yet initialized — schedule initialization AFTER render (NG0600 fix)
    queueMicrotask(() => this.initBookingState(msgId, bookingData));

    // Return a synchronous default so the template doesn't crash while waiting
    const user = this.account.user();
    const services = bookingData?.services || [];
    const stylists = bookingData?.stylists || [];
    const svc = services.find((s: any) => s.id === bookingData?.preselectedServiceId) || services[0] || { id: 'svc-haircut', name: "Men's Precision Haircut", price: 249 };
    const st = stylists.find((s: any) => s.id === bookingData?.preselectedStylistId) || stylists[0] || { id: 'stylist-vikram', name: 'Vikram Sharma', avatar_url: '' };
    return {
      serviceId: svc.id, serviceName: svc.name, price: Number(svc.price || 249),
      stylistId: st.id, stylistName: st.name, stylistAvatar: st.avatar_url,
      dateStr: bookingData?.preselectedDate || this.dateOptions()[0]?.dateStr || new Date().toISOString().split('T')[0],
      timeSlot: bookingData?.preselectedTimeSlot || '11:00 AM',
      customerName: user?.name || '', customerPhone: (user as any)?.phone || '',
      customerEmail: user?.email || 'guest@urbanblade.in',
    };
  }

  /** Initializes booking form state — called OUTSIDE render cycle via queueMicrotask */
  private initBookingState(msgId: string, bookingData: any): void {
    if (this.activeBookingForm()[msgId]) return; // already set by a concurrent call

    const user = this.account.user();
    const services = bookingData?.services || [];
    const stylists = bookingData?.stylists || [];

    const preService =
      services.find((s: any) => s.id === bookingData?.preselectedServiceId) ||
      services[0] || { id: 'svc-haircut', name: "Men's Precision Haircut", price: 249 };

    const preStylist =
      stylists.find((st: any) => st.id === bookingData?.preselectedStylistId) ||
      stylists[0] || { id: 'stylist-vikram', name: 'Vikram Sharma', role: 'Master Barber', avatar_url: '/images/stylists/vikram.jpg' };

    const initState: BookingFormState = {
      serviceId: preService.id, serviceName: preService.name, price: Number(preService.price || 249),
      stylistId: preStylist.id, stylistName: preStylist.name, stylistAvatar: preStylist.avatar_url,
      dateStr: bookingData?.preselectedDate || this.dateOptions()[0]?.dateStr || new Date().toISOString().split('T')[0],
      timeSlot: bookingData?.preselectedTimeSlot || '11:00 AM',
      customerName: user?.name || '', customerPhone: (user as any)?.phone || '',
      customerEmail: user?.email || 'guest@urbanblade.in',
    };

    this.activeBookingForm.update((map) => ({ ...map, [msgId]: initState }));
  }

  setBookingService(msgId: string, svc: any): void {
    this.activeBookingForm.update((map) => {
      const cur = map[msgId];
      if (!cur) return map;
      return {
        ...map,
        [msgId]: {
          ...cur,
          serviceId: svc.id,
          serviceName: svc.name,
          price: Number(svc.price),
        },
      };
    });
  }

  setBookingStylist(msgId: string, stylist: any): void {
    this.activeBookingForm.update((map) => {
      const cur = map[msgId];
      if (!cur) return map;
      return {
        ...map,
        [msgId]: {
          ...cur,
          stylistId: stylist.id,
          stylistName: stylist.name,
          stylistAvatar: stylist.avatar_url,
        },
      };
    });
  }

  setBookingDate(msgId: string, dateStr: string): void {
    this.activeBookingForm.update((map) => {
      const cur = map[msgId];
      if (!cur) return map;
      return {
        ...map,
        [msgId]: {
          ...cur,
          dateStr,
        },
      };
    });
  }

  setBookingSlot(msgId: string, slot: string): void {
    this.activeBookingForm.update((map) => {
      const cur = map[msgId];
      if (!cur) return map;
      return {
        ...map,
        [msgId]: {
          ...cur,
          timeSlot: slot,
        },
      };
    });
  }

  updateBookingCustomer(msgId: string, field: 'name' | 'phone', val: string): void {
    this.activeBookingForm.update((map) => {
      const cur = map[msgId];
      if (!cur) return map;
      return {
        ...map,
        [msgId]: {
          ...cur,
          ...(field === 'name' ? { customerName: val } : { customerPhone: val }),
        },
      };
    });
  }

  submitInChatBooking(msgId: string, venue?: string, hotline?: string): void {
    const form = this.activeBookingForm()[msgId];
    if (!form) return;

    const user = this.account.user();
    const finalName = (form.customerName || user?.name || 'Valued Guest').trim();
    const finalPhone = (form.customerPhone || (user as any)?.phone || '9015618265').trim();
    const finalEmail = user?.email || form.customerEmail || 'client@urbanblade.in';

    this.isSubmittingBooking.update((map) => ({ ...map, [msgId]: true }));
    this.bookingError.update((map) => ({ ...map, [msgId]: null }));

    const payload = {
      customerName: finalName,
      customerEmail: finalEmail,
      customerPhone: finalPhone,
      stylistId: form.stylistId,
      serviceId: form.serviceId,
      serviceName: form.serviceName,
      bookingDate: form.dateStr,
      timeSlot: form.timeSlot,
      totalPrice: form.price,
      notes: `Direct in-chat reservation via Urban AI Concierge · Barber: ${form.stylistName}`,
    };

    this.http.post<{ id: string; status: string; message: string }>('/api/bookings', payload).subscribe({
      next: (res) => {
        this.isSubmittingBooking.update((map) => ({ ...map, [msgId]: false }));

        const ticket: ConfirmedBookingTicket = {
          bookingId: res.id,
          serviceName: form.serviceName,
          price: form.price,
          stylistName: form.stylistName,
          stylistAvatar: form.stylistAvatar,
          dateStr: form.dateStr,
          timeSlot: form.timeSlot,
          customerName: finalName,
          venue: venue || 'Urban Blade Flagship Studio, Plot C-12, Sector 63, Noida',
          hotline: hotline || '+91 90156 18265',
          confirmedAt: new Date().toISOString(),
        };

        this.confirmedBookings.update((map) => ({ ...map, [msgId]: ticket }));

        // Send confirmation receipt as message into inquiry
        const receiptMsg: ChatMessage = {
          id: `bkg-confirm-${Date.now()}`,
          sender: 'ai',
          text: `🎉 Appointment Confirmed!\n\nYour chair is reserved with Master Barber ${form.stylistName} for ${form.serviceName} on ${form.dateStr} at ${form.timeSlot}.\n\nBooking Reference: #${res.id.slice(0, 8).toUpperCase()}`,
          timestamp: new Date().toISOString(),
          operation: {
            type: 'salon_booking_confirmed',
            bookingConfirmed: {
              id: res.id,
              customerName: finalName,
              serviceName: form.serviceName,
              stylistName: form.stylistName,
              stylistAvatar: form.stylistAvatar,
              bookingDate: form.dateStr,
              timeSlot: form.timeSlot,
              totalPrice: form.price,
              venue: venue || 'Urban Blade Flagship Studio, Sector 63, Noida',
              hotline: hotline || '+91 90156 18265',
            },
          },
          actionChips: [
            { label: '📍 View My Bookings', query: 'Show my account bookings' },
            { label: '📦 Track My Order', query: 'Where is my order?' },
            { label: '✨ Bestselling Grooming Products', query: 'Show bestsellers' },
          ],
        };

        this.messages.update((list) => [...list, receiptMsg]);
        this.scrollToBottom('smooth');
      },
      error: (err) => {
        this.isSubmittingBooking.update((map) => ({ ...map, [msgId]: false }));
        const errMsg = err?.error?.message || 'The selected slot was just taken. Please choose another slot or stylist.';
        this.bookingError.update((map) => ({ ...map, [msgId]: errMsg }));
      },
    });
  }

  // ─── 1-CLICK ADD TO CART ──────────────────────────────────────────────────

  addToCart(product: any): void {
    if (!product?.id) return;

    const p: Product = {
      id: product.id,
      name: product.name,
      slug: product.slug || product.id,
      description: product.description || '',
      longDescription: product.description || '',
      highlights: [],
      price: Number(product.price),
      compareAtPrice: product.compare_at_price ? Number(product.compare_at_price) : undefined,
      currency: 'INR',
      imageUrl: product.image_url || '/images/products/svc-mens-spa.jpg',
      category: (product.category as any) || 'hair',
      kind: 'retail',
      vendor: 'Urban Blade Flagship',
      audience: 'men',
      rating: Number(product.rating || 4.8),
      reviewCount: Number(product.review_count || 45),
      badge: product.badge as any,
      inStock: true,
    };

    this.cartService.addProduct(p, 1);

    this.addedProductIds.update((set) => {
      const next = new Set(set);
      next.add(product.id);
      return next;
    });

    setTimeout(() => {
      this.addedProductIds.update((set) => {
        const next = new Set(set);
        next.delete(product.id);
        return next;
      });
    }, 2500);
  }

  cancelOrder(orderId?: string): void {
    if (!orderId) return;
    const shortId = orderId.slice(0, 8).toUpperCase();
    this.sendMessage(`Cancel order #${shortId}`);
  }

  openCarrierUrl(url?: string): void {
    if (url && typeof window !== 'undefined') {
      window.open(url, '_blank');
    }
  }

  navigateToBookings(): void {
    this.isOpen.set(false);
    this.router.navigate(['/account'], { queryParams: { tab: 'bookings' } });
  }

  viewProduct(slug?: string): void {
    this.isOpen.set(false);
    if (slug) {
      this.router.navigate(['/shop', slug]);
    } else {
      this.router.navigate(['/shop']);
    }
  }

  onChipClick(chip: ChatActionChip): void {
    this.sendMessage(chip.query);
  }
}
