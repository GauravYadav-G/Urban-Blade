import { Component, inject, signal, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { SALON } from '@core/constants/salon.constants';
import { AccountService } from '@core/services/account.service';
import { CartService } from '@core/services/cart.service';
import type { ChatOperationPayload, ChatActionChip } from '@core/models/support.model';
import type { Product } from '@core/models/product.model';

export interface BookingFormState {
  serviceId: string;
  serviceName: string;
  price: number;
  stylistId: string;
  stylistName: string;
  stylistAvatar: string;
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
  stylistAvatar: string;
  dateStr: string;
  timeSlot: string;
  customerName: string;
  venue: string;
  hotline: string;
  confirmedAt: string;
}

export interface ChatBubble {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: string;
  operation?: ChatOperationPayload;
  actionChips?: ChatActionChip[];
}

@Component({
  selector: 'app-support-page',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink],
  templateUrl: './support-page.html',
  styleUrl: './support-page.scss',
})
export class SupportPage implements OnInit {
  readonly salon = SALON;
  protected readonly account = inject(AccountService);
  private readonly cartService = inject(CartService);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);

  readonly addedProductIds = signal<Set<string>>(new Set<string>());

  // In-Chat Booking Wizard State
  readonly activeBookingForm = signal<Record<string, BookingFormState>>({});
  readonly confirmedBookings = signal<Record<string, ConfirmedBookingTicket>>({});
  readonly isSubmittingBooking = signal<Record<string, boolean>>({});
  readonly bookingError = signal<Record<string, string | null>>({});

  readonly dateOptions = signal<Array<{ label: string; dateStr: string; dayName: string }>>([]);
  readonly slotOptions = signal<string[]>([
    '09:30 AM',
    '11:00 AM',
    '12:30 PM',
    '02:00 PM',
    '03:30 PM',
    '04:00 PM',
    '05:30 PM',
    '07:00 PM',
    '08:30 PM',
  ]);

  // Live AI Chat State
  readonly chatMessages = signal<ChatBubble[]>([
    {
      id: 'welcome',
      sender: 'ai',
      text: `Hi there! How can I help you today? You can track an order, book a salon chair, or ask any question about grooming products.`,
      timestamp: new Date().toISOString(),
      actionChips: [
        { label: 'Track my order', query: 'Where is my order?' },
        { label: 'Services & prices', query: 'What are your haircut prices?' },
        { label: 'Studio details', query: 'Where is your studio located?' },
        { label: 'Hair care advice', query: 'What should I do for hair fall?' },
        { label: 'Beard care advice', query: 'How to fix a patchy beard?' }
      ]
    },
  ]);

  readonly chatError = signal('');
  readonly ticketError = signal('');
  @ViewChild('chatViewport') private viewport?: ElementRef<HTMLDivElement>;
  private failedMessage: { id: string; text: string } | null = null;
  readonly userInput = signal<string>('');
  readonly isGenerating = signal<boolean>(false);

  // Ticket Modal State
  readonly ticketModalOpen = signal<boolean>(false);
  readonly ticketSuccessMessage = signal<string>('');
  readonly isSubmittingTicket = signal<boolean>(false);

  readonly ticketForm = this.fb.nonNullable.group({
    userName: ['', [Validators.required]],
    userEmail: ['', [Validators.required, Validators.email]],
    subject: ['', [Validators.required]],
    orderId: [''],
    vendorName: [''],
    priority: ['medium' as 'low' | 'medium' | 'high'],
    message: ['', [Validators.required, Validators.minLength(10)]],
  });

  readonly quickPrompts = [
    { label: 'Track an order', query: 'Where is my order?' },
    { label: 'Services & prices', query: 'What are your haircut prices?' },
    { label: 'Studio details', query: 'Where is your studio located?' },
    { label: 'Hair care advice', query: 'What should I do for hair fall?' },
    { label: 'Beard care advice', query: 'How to fix a patchy beard?' },
    { label: 'Book a visit', query: 'Book appointment' },
    { label: 'Returns & exchanges', query: 'What is the return and warranty policy?' },
  ];

  readonly topics = [
    { title: 'Your orders', body: 'Find your purchases, delivery details and tax invoices in one place.', route: '/account', query: {}, link: 'Open my account' },
    { title: 'Studio appointments', body: 'Explore our services and choose a time for your next visit.', route: '/book', query: {}, link: 'Book a visit' },
    { title: 'Grooming essentials', body: 'Discover hair, beard and skin care for your everyday routine.', route: '/shop', query: {}, link: 'Explore the collection' },
  ];

  ngOnInit(): void {
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

    const user = this.account.user();
    if (user) {
      this.ticketForm.patchValue({
        userName: user.name,
        userEmail: user.email,
      });
    }
  }

  sendChatMessage(customText?: string): void {
    const text = (customText || this.userInput()).trim();
    if (!text || this.isGenerating()) return;
    this.chatError.set('');
    this.failedMessage = null;

    const userMsg: ChatBubble = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date().toISOString(),
    };

    this.chatMessages.update((msgs) => [...msgs, userMsg]);
    if (!customText) {
      this.userInput.set('');
    }

    this.isGenerating.set(true);
    this.scrollChat();

    this.http
      .post<{ 
        ok: boolean; 
        reply: string; 
        operation?: ChatOperationPayload; 
        actionChips?: ChatActionChip[] 
      }>('/api/support/ai-chat', {
        message: text,
        customerName: this.account.user()?.name,
        customerEmail: this.account.user()?.email,
      })
      .subscribe({
        next: (res) => {
          this.isGenerating.set(false);
          this.scrollChat();
          const reply = res?.reply || "I've logged your request. Our support specialists are available on live chat or telephone.";
          this.chatMessages.update((msgs) => [
            ...msgs,
            {
              id: `ai-${Date.now()}`,
              sender: 'ai',
              text: reply,
              timestamp: new Date().toISOString(),
              operation: res?.operation,
              actionChips: res?.actionChips,
            },
          ]);
        },
        error: () => {
          this.isGenerating.set(false);
          this.failedMessage = { id: userMsg.id, text };
          this.chatError.set('Your message could not be sent. Please try again or contact our studio team.');
        },
      });
  }

  retryChatMessage(): void {
    const failed = this.failedMessage;
    if (!failed || this.isGenerating()) return;
    this.chatMessages.update(messages => messages.filter(message => message.id !== failed.id));
    this.sendChatMessage(failed.text);
  }

  onChatKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault(); this.sendChatMessage();
    }
  }

  private scrollChat(): void {
    setTimeout(() => {
      const element = this.viewport?.nativeElement;
      if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
    }, 0);
  }

  addToCart(product: any): void {
    if (!product?.id) return;

    if (product.kind === 'service' || product.category === 'services') {
      void this.router.navigate(['/book'], { queryParams: { service: product.id } });
      return;
    }

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
      kind: product.kind === 'gift' ? 'gift' : 'retail',
      vendor: 'Urban Blade Flagship',
      audience: 'men',
      rating: Number(product.rating || 4.8),
      reviewCount: Number(product.review_count || 45),
      badge: product.badge as any,
      inStock: true
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
    this.sendChatMessage(`Cancel order #${shortId}`);
  }

  openCarrierUrl(url?: string): void {
    if (url && typeof window !== 'undefined') {
      window.open(url, '_blank');
    }
  }

  bookAppointment(): void {
    this.router.navigate(['/book']);
  }

  getBookingState(msgId: string, bk: any): BookingFormState {
    const current = this.activeBookingForm()[msgId];
    if (current) return current;

    const user = this.account.user();
    const defaultService = bk.services?.find((s: any) => s.id === bk.preselectedServiceId) || bk.services?.[0] || {
      id: '',
      name: '',
      price: 0,
    };
    const defaultStylist = {id:'',name:'',avatar_url:''};
    const defaultDate = bk.preselectedDate || (this.dateOptions()[0]?.dateStr ?? new Date().toISOString().split('T')[0]);
    const defaultSlot = bk.preselectedTimeSlot || '11:00 AM';

    const initState: BookingFormState = {
      serviceId: defaultService.id,
      serviceName: defaultService.name,
      price: defaultService.price,
      stylistId: defaultStylist.id,
      stylistName: defaultStylist.name,
      stylistAvatar: defaultStylist.avatar_url,
      dateStr: defaultDate,
      timeSlot: defaultSlot,
      customerName: user?.name || '',
      customerPhone: (user as any)?.phone || '',
      customerEmail: user?.email || '',
    };

    setTimeout(() => {
      this.activeBookingForm.update((map) => ({ ...map, [msgId]: initState }));
    }, 0);

    return initState;
  }

  setBookingService(msgId: string, service: any): void {
    this.activeBookingForm.update((map) => {
      const cur = map[msgId];
      if (!cur) return map;
      return {
        ...map,
        [msgId]: {
          ...cur,
          serviceId: service.id,
          serviceName: service.name,
          price: service.price,
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
    const finalPhone = (form.customerPhone || user?.phone || '').trim();
    const finalEmail = user?.email || form.customerEmail || '';

    this.isSubmittingBooking.update((map) => ({ ...map, [msgId]: true }));
    this.bookingError.update((map) => ({ ...map, [msgId]: null }));

    const payload = {
      customerName: finalName,
      customerEmail: finalEmail,
      customerPhone: finalPhone,
      serviceId: form.serviceId,
      serviceName: form.serviceName,
      bookingDate: form.dateStr,
      timeSlot: form.timeSlot,
      totalPrice: form.price,
      notes: form.serviceName,
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

        const receiptMsg: ChatBubble = {
          id: `bkg-confirm-${Date.now()}`,
          sender: 'ai',
          text: `🎉 Appointment Confirmed!\n\nYour salon visit is reserved for ${form.serviceName} on ${form.dateStr} at ${form.timeSlot}.\n\nBooking Reference: #${res.id.slice(0, 8).toUpperCase()}`,
          timestamp: new Date().toISOString(),
          operation: {
            type: 'salon_booking_confirmed',
            bookingConfirmed: {
              id: res.id,
              serviceName: form.serviceName,
              stylistName: form.stylistName,
              stylistAvatar: form.stylistAvatar,
              bookingDate: form.dateStr,
              timeSlot: form.timeSlot,
              customerName: finalName,
              totalPrice: form.price,
              venue: venue || 'Plot C-12, Sector 63, Noida',
              hotline: hotline || '+91 90156 18265',
            },
          },
        };

        this.chatMessages.update((msgs) => [...msgs, receiptMsg]);
      },
      error: (err) => {
        this.isSubmittingBooking.update((map) => ({ ...map, [msgId]: false }));
        const msg = err.error?.error || 'Chair slot is currently locked. Please select another time slot.';
        this.bookingError.update((map) => ({ ...map, [msgId]: msg }));
      },
    });
  }

  navigateToBookings(): void {
    this.router.navigate(['/account']);
  }

  viewProduct(slug?: string): void {
    if (slug) {
      this.router.navigate(['/shop', slug]);
    } else {
      this.router.navigate(['/shop']);
    }
  }

  onPromptClick(prompt: { label: string; query: string }): void {
    this.sendChatMessage(prompt.query);
  }

  openTicketModal(): void {
    this.ticketModalOpen.set(true);
    this.ticketSuccessMessage.set('');
    this.ticketError.set('');
  }

  closeTicketModal(): void {
    this.ticketModalOpen.set(false);
    this.ticketSuccessMessage.set('');
  }

  submitTicket(): void {
    if (this.isSubmittingTicket()) return;
    this.ticketError.set('');
    if (this.ticketForm.invalid) {
      this.ticketForm.markAllAsTouched();
      return;
    }

    this.isSubmittingTicket.set(true);
    const formVals = this.ticketForm.getRawValue();

    this.http
      .post<{ ok: boolean; inquiryId: string; message: string }>('/api/support/inquiries', formVals)
      .subscribe({
        next: (res) => {
          this.isSubmittingTicket.set(false);
          this.ticketSuccessMessage.set(res.message || 'Your support ticket has been dispatched to our priority desk.');
          setTimeout(() => {
            this.closeTicketModal();
            this.ticketForm.reset();
          }, 3000);
        },
        error: () => {
          this.isSubmittingTicket.set(false);
          this.ticketError.set('Your request was not submitted. Your details are still here; please try again.');
        },
      });
  }
}
