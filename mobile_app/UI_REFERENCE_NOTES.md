> Superseded by [the 1.4.0 glass redesign](design/README.md), which restores original Plus Jakarta Sans typography and adds generated references for all flows.

# Reference-led mobile redesign — 1.3.0 (6)

## Reading the supplied references

All three images supplied in this request were reviewed. The first image repeats the same three-screen arrangement twice.

1. **Cleanser search, product detail, shopping bag:** rounded pale surfaces; a staggered two-column product grid; minimal icon controls; a large product image; compact quantity steppers; a simple bag summary and prominent checkout action. Applied the compact bag rows, quiet cards, circular add controls and image-led detail hierarchy. Kept accessible touch areas rather than copying the reference's tiny targets.
2. **Lumea serum collection:** warm taupe and ivory; restrained olive accents; airy wordmark; small category filters; product imagery leading the grid; a persistent bag summary. Applied the palette, centered brand header, category filtering and live bag summary. The bag summary opens the actual cart.
3. **Lumée landing, dashboard, product detail:** serif editorial headline paired with clean interface typography; ample space; warm product photography; simple bottom navigation; thin borders; description accordion; quantity alongside add-to-cart. Applied the typographic contrast, home composition, navigation, detail accordion and quantity selection.

Urban Blade retains its own catalog, currency, services and brand. Reference skincare products, ingredient claims, ratings, review counts and certification badges were not invented for the app. Existing catalog photography remains attached to its products. The home collection image is a bundled editorial image.

## Scope

- Shared ivory/charcoal/olive theme, bundled Cormorant Garamond headings and Plus Jakarta Sans interface text.
- Home, header and navigation rebuilt; catalog cards, product detail and shopping bag redesigned.
- Theme and shared surface styling carry through services, booking, account, login, checkout, orders, receipts and tracking.
- Working search, category filtering, price sorting, wishlist, catalog add controls and bag summary.
- Product image zoom, expandable description, quantity selection, add to bag and buy now.
- Cart quantity changes, removal and undo; existing server-backed promotions and checkout retained.
- No runtime dependency on MockData. Missing rating, review count and volume no longer get fictional fallback values.

## Motion

Page changes use short opacity/translation transitions; retained tabs preserve scroll and form state, stop inactive tickers and animate incoming content. Booking steps crossfade. Navigation selection, service selection, favourite controls and quantity changes animate locally. Explicit animations honor the OS reduced-motion setting. Product images retain bounded decoding and caching. Scrolling product cards do not use backdrop blur.

No attached Android device was available. These implementation choices have not been measured as a 60/120 fps guarantee; use the existing profile-only `FRAME_METRICS` instrumentation on the target phone to measure build/raster timings.

## Verification

- 24 Flutter tests pass, including quantity-to-cart behavior, saved items, buy-now navigation, removal undo, reduced-motion cart, search, filters, narrow-screen large text, retained tabs, account/session synchronization and payment failure handling.
- Updated screenshot baselines cover home, shop, product details, cart, services, booking, profile, login, orders, payment history, tracking and receipts. The main redesigned screens were visually inspected after image decoding.
- The deployed read-only product catalog returned successfully during this run.
- The app continues to use the existing API and native Razorpay integration. No real purchase, booking, account creation or production deployment was performed. Merchant payment completion requires an authenticated device check.
- Android packaging retains the project's existing signing configuration; this is a device-validation APK, not a newly configured store release.

Screenshots: `test/goldens/`. Font license: `assets/fonts/CormorantGaramond-OFL.txt`.
