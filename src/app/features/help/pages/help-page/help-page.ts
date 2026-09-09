import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SALON } from '@core/constants/salon.constants';

@Component({
  selector: 'app-help-page',
  imports: [RouterLink],
  templateUrl: './help-page.html',
  styleUrl: './help-page.scss',
})
export class HelpPage {
  readonly salon = SALON;

  readonly departments = [
    {
      title: 'Hair care',
      route: '/shop',
      query: { cat: 'hair' },
      body: 'Shampoo, conditioner, hair oil, serum, wax, clay, gel, pomade, cream, spray, styling powder, hair colour, anti-dandruff treatment, hair growth, and heat protection spray.',
    },
    {
      title: 'Beard & moustache',
      route: '/shop',
      query: { cat: 'beard' },
      body: 'Beard oil, balm, wax, wash, shampoo, conditioner, serum, softener, growth serum, moustache wax, comb, brush, and beard straightener.',
    },
    {
      title: 'Skin',
      route: '/shop',
      query: { cat: 'skin' },
      body: "Men's charcoal face wash, de-tan home kit, and ladies glow day cream with SPF 30 — the same formulas used after a chair service.",
    },
    {
      title: 'Salon tools',
      route: '/shop',
      query: { cat: 'tools' },
      body: 'Precision beard trimmer, ionic hair dryer, and ceramic styling iron. Heat tools include a manufacturer cover.',
    },
    {
      title: 'Gift cards',
      route: '/shop',
      query: { cat: 'gifts' },
      body: '₹1,000 and ₹2,500 Urban Blade cards plus the couples spa voucher. Redeem on retail or a visit at the Pratap Vihar studio.',
    },
    {
      title: 'Salon services',
      route: '/shop',
      query: { cat: 'services' },
      body: "Men's precision haircut, ladies hair colour, and men's spa package. Book a slot — these are fulfilled in-salon, not shipped.",
    },
  ];

  readonly guides = [
    {
      title: 'How to use hair care',
      items: [
        'Shampoo on wet hair for 60 seconds, then conditioner from mid-lengths to ends for 2–3 minutes.',
        'Hair oil: two drops on damp hair before a blow-dry, or as a night serum on ends.',
        'Hair serum: one pump after styling. It is a monsoon / humidity finisher and protects to 230°C.',
        'Wax, clay, gel, pomade, cream, spray, and powder go on dry hair. Clay is matte and strong; wax is medium hold and restyleable.',
        'Heat protection spray first if you use the ionic dryer or ceramic iron.',
      ],
    },
    {
      title: 'How to use beard & moustache',
      items: [
        'Wash or shampoo the beard, then conditioner. Towel-dry before oil or balm.',
        'Beard oil for softness and itch. Balm or wax for shape. Softener if the beard feels wiry.',
        'Moustache wax for hold on the ends. Comb or brush to distribute product and train the hair.',
        'Growth serum on clean skin under the beard. Straightener only on dry hair, never on oil-soaked hair.',
      ],
    },
    {
      title: 'Skin, tools, and colour',
      items: [
        'Charcoal face wash after a haircut or shave. De-tan kit as labelled — do not leave on longer than the card says.',
        'Ladies glow cream is a day cream with SPF 30. Use in the morning, not as a night mask.',
        'Hair colour is for home use on dry, unwashed hair. Strand-test first. We cannot take back opened colour.',
        'Anti-dandruff treatment and hair growth products are leave-on or rinse-off as printed on the bottle.',
      ],
    },
  ];

  readonly policies = [
    {
      title: 'Delivery',
      body: 'Most hair, beard, skin, tool, and gift-card orders across NCR leave the same or next day from the salon store. Free delivery is marked on the product page. Services are not shipped.',
    },
    {
      title: 'Returns',
      body: 'Unopened retail can be returned within 7 days. Opened shampoo, oil, serum, colour, beard, and skin products cannot come back for hygiene. Tools can be exchanged if unused in original packing.',
    },
    {
      title: 'Gift cards and vouchers',
      body: 'Urban Blade gift cards work on the store and at the chair. The couples spa voucher is redeemed at the studio — call before you visit so a slot is held.',
    },
    {
      title: 'Your list and recently viewed',
      body: 'On any product page, tap Add to your list to save shampoo, beard oil, tools, or a gift card. Recently viewed items stay in this browser.',
    },
  ];
}
