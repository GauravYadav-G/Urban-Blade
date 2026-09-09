import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SALON } from '@core/constants/salon.constants';

@Component({
  selector: 'app-support-page',
  imports: [RouterLink],
  templateUrl: './support-page.html',
  styleUrl: './support-page.scss',
})
export class SupportPage {
  readonly salon = SALON;

  readonly topics = [
    {
      title: 'Hair care orders',
      body: 'Wrong shampoo or conditioner, leaking hair oil, missing serum, or a colour shade that does not match the listing. Share your order ID and product name.',
      route: '/shop',
      query: { cat: 'hair' },
      link: 'Shop hair care',
    },
    {
      title: 'Beard & moustache orders',
      body: 'Damaged beard oil or balm, broken comb or brush, or a straightener that will not heat. We replace unused items that arrive faulty.',
      route: '/shop',
      query: { cat: 'beard' },
      link: 'Shop beard care',
    },
    {
      title: 'Skin product orders',
      body: 'Charcoal face wash, de-tan kit, or glow cream with a broken seal, missing sachet, or expiry concern. Do not use a damaged pack — write to us first.',
      route: '/shop',
      query: { cat: 'skin' },
      link: 'Shop skin',
    },
    {
      title: 'Tools and devices',
      body: 'Trimmer, ionic dryer, or ceramic iron that is dead on arrival, missing a part, or under manufacturer cover. Keep the box and invoice for a replacement.',
      route: '/shop',
      query: { cat: 'tools' },
      link: 'Shop tools',
    },
    {
      title: 'Gift cards',
      body: '₹1,000 or ₹2,500 card not applying at checkout, or a card sent to the wrong email. We can resend the code to the same order email.',
      route: '/shop',
      query: { cat: 'gifts' },
      link: 'Shop gift cards',
    },
    {
      title: 'Delivery and returns',
      body: 'Track a late parcel, request a re-ship, or return an unopened product within 7 days. Opened liquids, colour, and skin packs cannot be taken back.',
      route: '/orders',
      query: {},
      link: 'Your orders',
    },
  ];
}
