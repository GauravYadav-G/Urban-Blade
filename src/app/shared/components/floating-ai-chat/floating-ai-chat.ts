import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
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
  protected readonly account = inject(AccountService);
  private readonly cartService = inject(CartService);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);

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

  readonly messages = signal<ChatMessage[]>([
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
  ]);

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
        if (id && (!event.data?.inquiryId || event.data.inquiryId === id)) {
          this.fetchLatestInquiry(id);
        }
      };
    }

    // Background sync with database every 2.5 seconds
    this.pollInterval = setInterval(() => {
      const id = this.inquiryId();
      if (id) {
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
    }
  }

  fetchLatestInquiry(id: string): void {
    this.http
      .get<{ data: { id: string; messages: ChatMessage[]; status: string } | null; notFound?: boolean }>(
        `/api/support/inquiries/${id}`
      )
      .subscribe({
        next: (res) => {
          if (res?.notFound || !res?.data) {
            localStorage.removeItem('urban_active_inquiry_id');
            this.inquiryId.set(null);
            return;
          }

          if (res?.data?.messages && Array.isArray(res.data.messages)) {
            const newMsgs = res.data.messages;
            const oldLen = this.messages().length;

            if (!this.isOpen() && newMsgs.length > oldLen) {
              const hasNewAdminMsg = newMsgs.slice(oldLen).some((m) => m.sender === 'admin');
              if (hasNewAdminMsg) {
                this.unreadAdminCount.update((c) => c + 1);
              }
            }

            this.messages.set(newMsgs);
          }
        },
        error: () => {
          localStorage.removeItem('urban_active_inquiry_id');
          this.inquiryId.set(null);
        },
      });
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
          if (this.broadcastChannel) {
            this.broadcastChannel.postMessage({ type: 'USER_QUERY', inquiryId: res.inquiryId });
          }
        },
        error: () => {
          this.isGenerating.set(false);
          this.messages.update((list) => [
            ...list,
            {
              id: `err-${Date.now()}`,
              sender: 'ai',
              text: 'Our Master Concierge Desk (+91 90156 18265) has recorded your inquiry. A specialist will assist you promptly.',
              timestamp: new Date().toISOString(),
            },
          ]);
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
