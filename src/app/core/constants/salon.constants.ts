export const SALON = {
  name: 'Urban Blade',
  tagline: 'Salon store · Grooming delivered',
  phone: '9015618265',
  phoneDisplay: '+91 90156 18265',
  phoneTel: '+919015618265',
  email: 'urbanbladestudio@gmail.com',
  address: 'L-245, Sec-12, Pratap Vihar, Ghaziabad',
  city: 'Ghaziabad',
  pin: '201009',
  hours: 'Mon–Sun: 7 AM – 11 PM',
  mapsUrl: 'https://maps.google.com/?q=L-245,+Sec-12,+Pratap+Vihar,+Ghaziabad',
} as const;

export const SEARCH_CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'hair', label: 'Hair Care' },
  { value: 'beard', label: 'Beard & Moustache' },
  { value: 'skin', label: 'Skin' },
  { value: 'tools', label: 'Tools' },
  { value: 'gifts', label: 'Gift Cards' },
  { value: 'services', label: 'Services' },
] as const;

export const MAIN_NAV: { label: string; route: string; query?: Record<string, string> }[] = [
  { label: 'Home', route: '/' },
  { label: 'Shop', route: '/shop' },
  { label: 'Hair Care', route: '/shop', query: { cat: 'hair' } },
  { label: 'Beard & Moustache', route: '/shop', query: { cat: 'beard' } },
];

export const PAGES_NAV: { label: string; route: string }[] = [
  { label: 'My Account', route: '/account' },
  { label: 'Orders', route: '/orders' },
  { label: 'Book a Visit', route: '/book' },
  { label: 'Help / Support', route: '/help' },
];

export const DEMO_ACCOUNT = {
  name: 'Demo Guest',
  email: 'demo@urbanblade.in',
  password: 'Blade@123',
} as const;

export const ADMIN_ACCOUNT = {
  name: 'Master Admin',
  email: 'admin@urbanblade.in',
  password: 'Admin@2026',
  role: 'admin' as const,
};
