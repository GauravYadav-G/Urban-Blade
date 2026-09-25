export interface StoreUser {
  email: string;
  name: string;
  role?: 'admin' | 'customer' | 'stylist' | 'vendor';
  vendorId?: string;
  vendorName?: string;
  isImpersonated?: boolean;
}

export interface LoginCredentials {
  email: string;
  password: string;
}
