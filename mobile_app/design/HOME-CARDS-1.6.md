# Home cards · 1.6.0 (9)

Home categories now display catalog photography, a category name, item count and an arrow inside rounded cards. They retain category filtering. Featured booking cards offer At home and Salon visit; each sets the booking location before opening the booking flow. The home fee comes from SalonConstants. No booking is created by selecting a card.

Generated illustration photography is bundled locally, not presented as photographs of the actual studio. Existing catalog photography remains unchanged. Reduced-motion support, bounded image decoding and lazy retained tabs remain in use.

## Image generation

Built-in image_gen tool; two separate assets. Final files:
- `assets/images/heroes/booking-home.png`
- `assets/images/heroes/booking-salon.png`

Prompts:

1. Use case: photorealistic-natural. Asset type: premium Indian grooming app booking card, square photograph. A professional Indian male hairstylist in charcoal apron neatly trims the hair of an adult Indian man seated wearing a clean barber cape in an elegant residential living room, visible linen sofa, warm white plaster walls, olive foliage and a compact portable grooming kit. Clearly a home visit rather than a salon. Natural window daylight, muted stone, ivory and sage palette, candid editorial luxury photography, believable hands, medium-wide composition centered for cropping. No text, no logos, no watermarks.
2. Use case: photorealistic-natural. Asset type: premium grooming app salon-visit booking card, square photograph. An inviting luxury contemporary Indian grooming salon interior, elegant charcoal leather barber chair central foreground, arched mirror, pale limestone counter, neatly folded towels, small olive tree, muted sage cabinetry, clean brass details. Soft natural daylight, refined editorial architecture photography, warm white and stone neutral palette, realistic materials, medium-wide composition centered for cropping. No people, no text, no logos, no watermarks.

## Validation

27 tests pass, including both booking-location choices and category-to-product navigation. Analyzer clean. Home preview is in `test/goldens/home.png`. 120 FPS still requires physical-device measurement.
