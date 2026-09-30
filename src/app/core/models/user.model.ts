export interface StoreUser {
  id?: string;
  email: string;
  name: string;
  phone?: string | null;
  role?: 'admin' | 'customer' | 'stylist' | 'vendor';
  vendorId?: string;
  vendorName?: string;
  isImpersonated?: boolean;
}

export interface LoginCredentials {
  email: string;
  password: string;
}
