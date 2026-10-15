# Urban Blade glass redesign — 1.4.0 (7)

[Open the reference and implementation gallery](index.html). [Exact generation prompts](PROMPTS.md).

## Reference analysis

The supplied Lumée reference uses a warm ivory canvas, a large product still life, compact product cards, quiet outlines, and a strong dark action. Its depth comes from photographed directional light, contact shadows below products, and broad soft shadows around surfaces. The Scentora reference extends the system through search, catalog, detail, bag, saved items and account pages. It uses a dense dashboard, useful category shortcuts, prominent photography and consistent bottom navigation.

The previous build lost that depth through flat fills, no card shadows and an oversized landing composition. This revision restores the app's original **Plus Jakarta Sans** throughout, including headings and wordmark. No runtime screen uses Cormorant Garamond. Forest green actions are restored.

The user also requested glassmorphism. Glass now has a bright edge, translucent white-to-ivory fill, an outer ambient shadow and a smaller contact shadow. The shadow is outside the rounded clip. Floating navigation, action docks and sheets use a real 16 px backdrop blur. Scrolling cards use translucent gradients without per-card blur, preserving scrolling performance. A sand/sage atmospheric backdrop lets the glass show depth. The generated still-life image gives home and authentication screens directional light and texture.

## Generated reference set

Four separate boards were generated with the built-in imagegen tool **before implementation**, covering every main page and supporting flow state. These are concepts, not customer records. Concept names, prices, product claims and extra mockup controls were not imported as runtime business data.

| Board | Screens |
| --- | --- |
| [Shopping](references/01-shopping.png) | Home dashboard, shop/search, product detail, shopping bag, checkout |
| [Booking](references/02-booking.png) | Services, service/stylist/location selection, schedule, review, confirmation |
| [Account](references/03-account.png) | Login, registration, profile, saved products, delivery editor |
| [Orders](references/04-orders.png) | Orders, tracking, payment history, receipt, appointments, order confirmation |

The supporting profile editor uses the same glass-sheet/form system; contact and directions retain the existing working external links. The app has no separate brand landing or wallet feature, so the generated concepts do not add fictitious brand data, balances, certifications, or payment methods.

## Implementation

- Dashboard rebuilt with category photographs that open the matching catalog, a compact promotional still life and product grid.
- Shared card-to-detail image transitions, press feedback, animated selected navigation, service selection, wishlist and quantities; existing retained-tab and booking-step transitions preserved.
- Product and service photography retains actual catalog assets. Generated unbranded still life is an editorial background only.
- Product quantity selection, wishlist, image zoom, search/sort/filter and cart undo remain connected to AppState.
- Services now use large photographed cards with selectable state. Booking selection/review panels use the shared material system.
- Profile, saved items, delivery editor, login and registration use the same typography and glass system.
- Checkout, orders, receipts, payment history and appointments receive the shared background and elevated panels.
- Checkout action stays visible in a fixed glass dock. Server errors appear alongside it with a screen-reader live region. Retry continues to use the existing pending server order.
- Success states use a one-time scale entrance on a glass check medallion.
- Reduced-motion settings disable explicit transition durations and shared-image flights. No continuous ornamental animation is used.

## Validation and previews

`test/goldens/` contains the main-screen screenshot baselines. `design/implemented/` contains captured account, address, saved-items, checkout and complete booking flow previews. All are rendered from Flutter widgets with **test-only fixtures**. No production transactions or bookings are created to produce images.

Shadows are enabled explicitly during screenshot capture, then the Flutter painting debug flag is reset. This avoids the test framework's default hard-shadow rendering. Preview images are inspected for clipping, legibility and actual shadow/blur behavior.

Run:

```sh
flutter analyze
flutter test
flutter test test/full_flow_preview_test.dart --dart-define=WRITE_UI_PREVIEWS=true
flutter build apk --release --build-name=1.4.0 --build-number=7
```

Checks cover original commerce/session/payment behavior plus home-category navigation, shared-image routes, booking steps and server confirmation, COD confirmation, saved-item and address sheets. The app still uses the existing API and native Razorpay integration. Real phone frame timing and live merchant payment completion require device validation; screenshot tests do not establish 60/120 fps. Existing Android signing configuration is retained.

Final verification: Flutter analyzer clean; all **26 tests passed** against the reviewed screenshot baselines. No Android device was attached for frame-time measurement.
