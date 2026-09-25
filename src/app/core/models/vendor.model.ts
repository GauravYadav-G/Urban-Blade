export interface VendorPayoutAccount {
  bank: string;
  accountNo: string;
  ifsc: string;
  upi?: string;
}

export interface VendorAccount {
  id: string;
  name: string;
  slug: string;
  email: string;
  password?: string;
  contact_person: string;
  phone: string;
  commission_rate: number;
  status: 'active' | 'pending' | 'suspended';
  payout_account?: VendorPayoutAccount;
  product_count?: number;
  total_sales?: number;
  order_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface VendorMetrics {
  totalRevenue: number;
  orderCount: number;
  productCount: number;
  averageOrderValue: number;
  commissionPaid: number;
  pendingPayout: number;
}
