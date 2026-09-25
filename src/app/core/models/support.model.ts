export interface ChatOperationPayload {
  type: 'order_tracking' | 'order_cancelled' | 'product_recommendations' | 'salon_booking' | 'salon_booking_confirmed' | 'policy_faq' | 'escalation';
  order?: {
    id: string;
    status: string;
    raw_status?: string;
    current_location?: string;
    carrier?: string;
    tracking_number?: string;
    portal_url?: string;
    estimated_delivery?: string;
    last_scan_time?: string;
    total_amount?: number;
    can_cancel?: boolean;
    items?: Array<{
      product_name: string;
      unit_price: number;
      quantity: number;
      image_url?: string;
    }>;
    checkpoints?: Array<{
      stage: string;
      location: string;
      timestamp: string;
      activity: string;
    }>;
  };
  products?: Array<{
    id: string;
    slug: string;
    name: string;
    price: number;
    compare_at_price?: number;
    image_url: string;
    category: string;
    in_stock: boolean;
    stock_quantity: number;
    badge?: string;
    rating?: number;
    review_count?: number;
    description?: string;
  }>;
  booking?: {
    stylists?: Array<{
      id: string;
      name: string;
      role: string;
      avatar_url: string;
      rating?: number;
    }>;
    services?: Array<{
      id: string;
      name: string;
      price: number;
      description?: string;
      image_url?: string;
    }>;
    venue?: string;
    hours?: string;
    hotline?: string;
    preselectedServiceId?: string;
    preselectedStylistId?: string;
    preselectedDate?: string;
    preselectedTimeSlot?: string;
  };
  bookingConfirmed?: {
    id: string;
    customerName: string;
    serviceName: string;
    stylistName: string;
    stylistAvatar?: string;
    bookingDate: string;
    timeSlot: string;
    totalPrice: number;
    venue?: string;
    hotline?: string;
    message?: string;
  };
  contact?: {
    phone: string;
    email: string;
    whatsapp: string;
    hours?: string;
  };
  policy?: string;
}

export interface ChatActionChip {
  label: string;
  query: string;
  icon?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'admin' | 'ai';
  text: string;
  timestamp: string;
  operation?: ChatOperationPayload;
  actionChips?: ChatActionChip[];
}

export interface SupportInquiry {
  id: string;
  user_name: string;
  user_email: string;
  subject: string;
  order_id?: string | null;
  vendor_name?: string | null;
  status: 'open' | 'ai_resolved' | 'escalated' | 'closed';
  priority: 'low' | 'medium' | 'high';
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
}

export interface AdminTask {
  id: string;
  title: string;
  description?: string;
  assignee: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'in_progress' | 'completed';
  due_date: string;
  related_user?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AiChatResponse {
  ok: boolean;
  reply: string;
  action: string;
  sentiment: 'positive' | 'neutral' | 'urgent';
  confidence: number;
  timestamp: string;
  agent: string;
  operation?: ChatOperationPayload;
  actionChips?: ChatActionChip[];
}
