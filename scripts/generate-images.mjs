import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const productsDir = join(root, 'public', 'images', 'products');
const heroesDir = join(root, 'public', 'images', 'heroes');
mkdirSync(productsDir, { recursive: true });
mkdirSync(heroesDir, { recursive: true });

const products = [
  { id: 'keratin-shampoo', label: 'Keratin Shampoo', tone: '#1f4d4a', accent: '#c9a227', shape: 'bottle' },
  { id: 'argan-hair-oil', label: 'Argan Oil', tone: '#5c3317', accent: '#e8b86d', shape: 'drop' },
  { id: 'colour-protect-mask', label: 'Colour Mask', tone: '#6b2d5b', accent: '#f3c6de', shape: 'jar' },
  { id: 'anti-frizz-serum', label: 'Anti-Frizz Serum', tone: '#243b55', accent: '#9fd3c7', shape: 'bottle' },
  { id: 'hair-spa-kit', label: 'Hair Spa Kit', tone: '#3d2b1f', accent: '#d4b483', shape: 'kit' },
  { id: 'beard-oil', label: 'Beard Oil', tone: '#2b2118', accent: '#c4a574', shape: 'drop' },
  { id: 'beard-wash', label: 'Beard Wash', tone: '#1c2833', accent: '#7f8c8d', shape: 'bottle' },
  { id: 'beard-kit', label: 'Beard Kit', tone: '#3e2723', accent: '#bfa07a', shape: 'kit' },
  { id: 'precision-trimmer', label: 'Trimmer', tone: '#111', accent: '#c0c0c0', shape: 'tool' },
  { id: 'charcoal-face-wash', label: 'Charcoal Wash', tone: '#1a1a1a', accent: '#888', shape: 'tube' },
  { id: 'detan-kit', label: 'De-Tan Kit', tone: '#8d6e63', accent: '#ffe0b2', shape: 'kit' },
  { id: 'glow-cream', label: 'Glow Cream', tone: '#ad1457', accent: '#f8bbd0', shape: 'jar' },
  { id: 'hair-dryer', label: 'Ionic Dryer', tone: '#263238', accent: '#90caf9', shape: 'tool' },
  { id: 'styling-iron', label: 'Styling Iron', tone: '#4a148c', accent: '#ce93d8', shape: 'tool' },
  { id: 'gift-1000', label: 'Gift Card ₹1,000', tone: '#1b5e20', accent: '#c9a227', shape: 'card' },
  { id: 'gift-2500', label: 'Gift Card ₹2,500', tone: '#b71c1c', accent: '#ffd54f', shape: 'card' },
  { id: 'couples-spa', label: 'Couples Spa', tone: '#4a148c', accent: '#e1bee7', shape: 'spa' },
  { id: 'svc-mens-haircut', label: "Men's Haircut", tone: '#212121', accent: '#febd69', shape: 'salon' },
  { id: 'svc-ladies-colour', label: 'Hair Colour', tone: '#880e4f', accent: '#f8bbd0', shape: 'salon' },
  { id: 'svc-mens-spa', label: "Men's SPA", tone: '#0d47a1', accent: '#90caf9', shape: 'spa' },
];

const shapePath = {
  bottle:
    'M170 70h60v30c18 8 28 28 28 50v170c0 22-18 40-40 40h-64c-22 0-40-18-40-40V150c0-22 10-42 28-50V70z',
  drop: 'M200 70c70 90 90 140 90 190a90 90 0 11-180 0c0-50 20-100 90-190z',
  jar: 'M140 90h120v30h20v170c0 22-18 40-40 40h-80c-22 0-40-18-40-40V120h20V90z',
  kit: 'M90 140h220v150c0 16-12 30-28 30H118c-16 0-28-14-28-30V140zm40-40h140l20 40H110l20-40z',
  tube: 'M180 50h40v40h30v250c0 16-14 30-30 30h-40c-16 0-30-14-30-30V90h30V50z',
  tool: 'M90 180h220v40H90v-40zm40-70h40v200h-40V110zm140 20h40v160h-40V130z',
  card: 'M80 120h240v160c0 10-8 18-18 18H98c-10 0-18-8-18-18V120z',
  spa: 'M80 220c40-80 80-110 120-110s80 30 120 110H80zm40 20h160v40H120v-40z',
  salon: 'M70 250h260v40H70v-40zm50-120h40v120h-40V130zm120-20h40v140h-40V110z',
};

function productSvg(p) {
  const path = shapePath[p.shape];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="800" height="800" role="img" aria-label="${p.label}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${p.tone}"/>
      <stop offset="1" stop-color="#0f1720"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".35"/>
      <stop offset="1" stop-color="#fff" stop-opacity=".05"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="url(#bg)"/>
  <circle cx="320" cy="70" r="90" fill="${p.accent}" fill-opacity=".18"/>
  <circle cx="60" cy="340" r="110" fill="${p.accent}" fill-opacity=".12"/>
  <path d="${path}" fill="${p.accent}" opacity=".95"/>
  <path d="${path}" fill="url(#shine)"/>
  <text x="200" y="36" text-anchor="middle" fill="${p.accent}" font-family="Georgia,serif" font-size="14" font-style="italic">urban blade</text>
  <text x="200" y="372" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="18" font-weight="700">${p.label}</text>
</svg>`;
}

function heroSvg(id, title, subtitle, tone) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 640" width="1600" height="640" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${tone}"/>
      <stop offset="1" stop-color="#0b0e14"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="640" fill="url(#g)"/>
  <circle cx="1280" cy="120" r="260" fill="#febd69" fill-opacity=".16"/>
  <circle cx="240" cy="520" r="200" fill="#fff" fill-opacity=".06"/>
  <rect x="980" y="120" width="420" height="400" rx="24" fill="#fff" fill-opacity=".08"/>
  <rect x="1020" y="170" width="340" height="220" rx="12" fill="#febd69" fill-opacity=".25"/>
  <text x="80" y="250" fill="#febd69" font-family="Georgia,serif" font-size="28" font-style="italic">Urban Blade</text>
  <text x="80" y="330" fill="#fff" font-family="Arial,sans-serif" font-size="54" font-weight="700">${title}</text>
  <text x="80" y="390" fill="#eaeaea" font-family="Arial,sans-serif" font-size="24">${subtitle}</text>
</svg>`;
}

for (const p of products) {
  writeFileSync(join(productsDir, `${p.id}.svg`), productSvg(p));
}

writeFileSync(
  join(heroesDir, 'hero-1.svg'),
  heroSvg('hero-1', 'Salon-grade grooming, delivered', 'The same products our stylists use in Ghaziabad.', '#1a1410'),
);
writeFileSync(
  join(heroesDir, 'hero-2.svg'),
  heroSvg('hero-2', "Ladies' colour & spa", 'Book a chair or take the spa kit home.', '#3b1028'),
);
writeFileSync(
  join(heroesDir, 'hero-3.svg'),
  heroSvg('hero-3', 'Gift a sharp look', 'Vouchers from ₹1,000 — instant email delivery.', '#10261c'),
);

writeFileSync(
  join(root, 'public', 'images', 'placeholder.svg'),
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <rect width="400" height="400" fill="#232f3e"/>
  <text x="200" y="210" text-anchor="middle" fill="#febd69" font-family="Georgia,serif" font-size="22" font-style="italic">Urban Blade</text>
</svg>`,
);

writeFileSync(
  join(root, 'public', 'images', 'logo.svg'),
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 48" width="220" height="48">
  <rect width="220" height="48" rx="4" fill="transparent"/>
  <text x="8" y="30" fill="#ffffff" font-family="Georgia, Times New Roman, serif" font-size="24" font-style="italic">urban</text>
  <text x="96" y="30" fill="#febd69" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" letter-spacing="1.2">BLADE</text>
  <path d="M12 38c48 10 120 10 196 0" stroke="#febd69" stroke-width="2.4" fill="none" stroke-linecap="round"/>
</svg>`,
);

console.log(`Wrote ${products.length} product images + 3 heroes`);
