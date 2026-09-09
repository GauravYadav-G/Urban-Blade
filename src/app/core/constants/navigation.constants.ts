export interface DrawerItem {
  label: string;
  hint?: string;
  route?: string;
  query?: Record<string, string>;
}

export interface DrawerSection {
  title: string;
  items: DrawerItem[];
}

export const DEPARTMENT_SECTIONS: DrawerSection[] = [
  {
    title: 'Shop by department',
    items: [
      { label: 'Hair Care', hint: 'Shampoo, oil, spa kits', route: '/shop', query: { cat: 'hair' } },
      { label: 'Beard & Moustache', hint: 'Oil, balm, wax, comb, brush', route: '/shop', query: { cat: 'beard' } },
      { label: 'Skin & Facials', hint: 'Wash, de-tan, glow', route: '/shop', query: { cat: 'skin' } },
      { label: 'Salon Tools', hint: 'Dryers, irons, shears', route: '/shop', query: { cat: 'tools' } },
      { label: 'Gift Cards', hint: 'Vouchers for any occasion', route: '/shop', query: { cat: 'gifts' } },
    ],
  },
  {
    title: 'Salon services',
    items: [
      { label: "Men's grooming", hint: 'Haircut, beard, spa', route: '/book' },
      { label: "Ladies' styling", hint: 'Cut, colour, spa', route: '/book' },
      { label: 'Book a chair', hint: 'Pick a slot at the salon', route: '/book' },
    ],
  },
  {
    title: 'Help & settings',
    items: [
      { label: 'Your account', route: '/account' },
      { label: 'Your orders', route: '/orders' },
      { label: 'Your basket', route: '/cart' },
      { label: 'Customer service', route: '/help' },
    ],
  },
];
