# Home and cart references — 1.9.0 (12)

References reviewed: `home.mov` and `cart.mov` in the workspace root.

The home screen uses the second video's dark background, prominent search pill, greeting, horizontal selection chips, swipeable feature cards with a neighboring-card preview, page indicators, round quick actions, product cards, and pastel service banner. All content is Urban Blade's existing catalog, imagery, booking locations, and INR pricing.

- Discover / Daily care / Salon time select the feature carousel; swiping updates the selected chip and indicator. Card height is measured from the actual font and text scale.
- Search and product cards use the existing catalog and detail routes. Booking shortcuts preselect home or studio. Category chips filter the shop.
- Home product additions animate into the cart dock. The home header and dock open a rounded cart sheet over a blurred and dimmed home screen. Dismissing the sheet retains the home scroll position; checkout continues through the existing sign-in and payment routes.
- The shop retains the sliding catalog reveal from `cart.mov`. Shared AppState keeps quantities, totals, promotions, and pending-payment restrictions consistent between both presentations.
- OS reduced-motion settings disable the product flight, blur, reveal, sheet motion, and carousel interpolation. Narrow/landscape layouts and large text have regression coverage.

Main implementation: `lib/features/home/home_screen.dart`, shared `lib/features/cart/cart_flow.dart`, `lib/features/cart/cart_screen.dart`, and `lib/features/main_shell.dart`.

Visual previews: `test/goldens/home-reference.png` and `test/goldens/home-cart-sheet.png`.

No camera search, voice search, membership claims, fabricated deals, or external-brand content were added. Android builds retain the project's existing signing configuration. Physical-device animation timing and real payment completion are not covered by widget tests.

Validation: all 43 Flutter tests pass and `flutter analyze` reports no issues. Both reference screens were rendered and visually reviewed.
