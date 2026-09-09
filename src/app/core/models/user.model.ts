export interface StoreUser {
  email: string;
  name: string;
  role?: 'admin' | 'customer' | 'stylist';
}

export interface LoginCredentials {
  email: string;
  password: string;
}
