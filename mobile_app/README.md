# Urban Blade mobile

Current version: **2.5.5 (25)**. Flutter Android/iOS client for the Urban Blade website API.

This release unifies the home dashboard with the rest of the app and introduces refractive liquid glass on the dashboard and navigation. The top bar uses a left-aligned editorial wordmark with separate glass profile and cart controls, with no appearance toggle. The theme-aware bottom dock uses a selected route pill and clean inactive icons. Home retains aligned studio/home tiles, a next-visit shortcut and daily essentials, without a home search bar. It retains glass product captions, the floating navigation dock and immersive product details. Softly lit backgrounds and short transitions connect the experience. It retains the earlier booking, account, payment and responsive-layout fixes. Light and dark modes keep Urban Blade's obsidian, amber and slate palette. See [the glass design report](design/GLASS-2.5.md) and [the preceding repair report](design/MOBILE-2.4.md).

Product detail controls use equal 48px touch targets and a centered title that hides when space is limited. The image zoom control has been removed. Quantity, description, and saved-item updates rebuild only their relevant sections; the photo and product panel remain stable during quantity and save interactions.

Android requests the highest refresh rate supported at the current display resolution, while respecting battery saver and system policy. To measure performance on a connected physical device:

```sh
flutter run --profile --dart-define=FRAME_METRICS=true
```

After warmup, `urbanblade.frames` logs build/raster percentiles and frames exceeding the display's reported refresh-rate budget. These measurements require real device testing; no fixed FPS is guaranteed.

## Video reference motion

`correctvi.mp4` (24.83 seconds, 30fps) guides the motion direction: short staggered reveals, a dark floating dock, card-to-detail continuity, and milky frosted sheets. The recording includes a rotating 3D phone presentation; the app reproduces the UI motion rather than the presentation camera.

[Flutter Animate](https://github.com/gskinner/flutter_animate) supplies the fade, move and blur effects. Reveals settle within 480ms and tab selection rises over 340ms. Android route transitions use translation and scale without filtering a full-screen texture. Scrolling cards use fade/move; blur is opt-in for small highlights. Reduced motion skips motion, and inactive tabs retain drafts with tickers disabled. Stable catalog widgets survive cart/badge updates, and hidden profile notifications are deferred. Nested glass controls share the enclosing sheet’s backdrop pass. iOS retains native interactive back navigation and shared-element product transitions.

The floating dock uses theme-aware glass with champagne selection. High contrast and accessible navigation use opaque surfaces. Product photos and scrolling cards retain bounded image decoding; the cart sheet samples a clipped backdrop rather than blurring the full catalog continuously.

## Rescheduling API compatibility (2.5.5)

If a hosted server is missing the new rescheduling routes, the app shows a clear
unavailable message and keeps the existing appointment unchanged. This does not
replace the required server deployment described below.

## Account and appointment update (2.5.4)

The account page groups profile details, orders and receipts, returns and refunds,
appointments, saved addresses and payments. Appearance controls live in settings.
Order aftercare uses the website's return endpoints and statuses, keeps decimal
amounts and refund references, and requires full-order acknowledgement before a
return request. Uncollected COD returns do not promise a refund.

Signed-in customers can add, edit, remove and choose multiple delivery addresses,
set a default, and use the same account address book as the website. Checkout uses
the selected address; editing or removing it reconciles the delivery draft.

Upcoming confirmed appointments expose **Reschedule appointment**. Customers choose
a date and an available time, then confirm the change. The server checks ownership,
future times, assigned-staff conflicts and concurrent schedule changes. The service,
price, visit address and staff assignment are preserved. Deploy the matching server
changes before using the reschedule controls against a hosted API; these endpoints
are new: `GET /api/bookings/:id/available-slots` and
`PUT /api/bookings/:id/schedule`. No database migration is required.

## Customer flows

- Public product and service browsing, search, saved items, and cart management.
- Website sign-in and registration, session restoration, profile editing and sign-out.
- One service per appointment, available dates and time slots, salon or home visits. The salon assigns staff. Home visits include the saved address; confirmation uses the server's current price.
- Order and appointment history, payment status, and PDF receipts. Android saves through the document picker; iOS exports through Files.
- Delivery editing, authoritative server quotes, COD and Razorpay checkout. Failed requests do not create local confirmations. Interrupted payments retain their draft for reconciliation.
- Retained tab drafts and scroll positions, light/dark/system appearance, supported Android wallpaper palettes and reduced-motion settings.

## Liquid glass and navigation

The shared glass renderer ports techniques from the requested
[Vue liquid glass repository](https://github.com/mkj0kjay/vue-web-liquid-glass)
and [LiquidGlass-Cpp](https://github.com/SilentEaves/LiquidGlass-Cpp).
`shaders/repository_liquid_glass.frag` combines the Vue convex-surface derivative
and Snell displacement with the C++ rounded lens curve, spectral sampling and
edge lighting. `RepositoryGlass` composes that shader with a bounded background
blur while keeping text and controls undistorted. The shader program is cached;
each surface owns and disposes its shader instance.

The four dashboard surfaces, navigation dock and independent header controls use
the same material. The top bar has left-aligned URBAN / BLADE branding and profile
and cart controls on the right. Appearance remains in Profile; its navbar toggle
is removed. Light, dark and wallpaper palettes use the app's semantic colors.

`ImageFilter.isShaderFilterSupported` selects native backdrop refraction on
supported Impeller backends. Other renderers use a frosted tint and directional
rim; high contrast and accessible navigation use opaque surfaces. Shader load
failures also retain the frosted fallback. Nested glass shares its enclosing
frost scope; long catalog lists retain lighter material. A pixel test renders
the actual GLSL against a synthetic image to check inward edge refraction, center
preservation and rounded clipping. Physical-device backdrop alignment and GPU
performance still require device testing; widget goldens show the software fallback.

Source revisions, changes and upstream license notices are recorded in
[third_party/liquid_glass/NOTICE.md](third_party/liquid_glass/NOTICE.md).
License assets are bundled and registered with Flutter's license registry.

## Image and availability reliability

The image widget uses [flutter_svg](https://pub.dev/packages/flutter_svg), listed in
[awesome-flutter](https://github.com/Solido/awesome-flutter), for SVG-only bundled
artwork and remote SVG URLs (including URLs with query parameters). Existing JPG
variants retain priority for local catalog artwork. Network bitmap images retain
`cached_network_image` and bounded decoding. Local fallbacks accept `assets/`,
`/images/`, and `images/` paths; missing fallback images show the Urban Blade tile.

Booking availability validates the response structure and rejects malformed or
empty time values with an actionable retry message. Valid empty availability
remains an empty day; repeated time values are trimmed and deduplicated. Connection
errors no longer claim that an unsuccessful request was saved locally and advise
checking order/payment status before resubmitting.

Requires Dart 3.9+ and Flutter 3.35+ for the SVG package.

## Run and verify

```sh
cd mobile_app
flutter pub get
flutter analyze
flutter test
flutter run
```

The default API endpoint is `https://urbanblade-api.onrender.com`, configured in `lib/core/constants/salon_constants.dart`.

Build Android from the repository root:

```sh
bash mobile_app/build_apk.sh
```

The script uses the version in `pubspec.yaml` and copies the APK to `UrbanBlade-2.5.5.apk` in the repository root. It also works when invoked from inside `mobile_app`.

For iOS simulator verification:

```sh
cd mobile_app
flutter build ios --simulator
```

Repository checks run from the repository root:

```sh
npm run test:guidelines
npm run test:admin
npm run build
```

## Release validation

The Android configuration currently signs release builds with the existing debug key. The generated APK is suitable for local device testing; store distribution requires production signing. iOS App Store distribution also requires your Apple signing configuration.

Checkout catches asynchronous native launch errors, releases the busy state with an actionable message, and reconciles payment status on app resume without opening another attempt. Android package visibility includes Google Pay, PhonePe, Paytm and BHIM. UPI intent is blocked with an explanation for test-mode server orders; standard test checkout remains available. Live UPI requires a live merchant order and a compatible installed app. Real Razorpay payments and UPI handoff still require physical-device verification with the configured merchant account. Automated tests make no purchases. Server quotes and receipt PDFs preserve authoritative decimal totals; existing catalog/cart/history summaries display whole rupees.

Mobile source, tests and assets are eligible for version control. SDK caches, generated platform files, signing keys, build output, APKs and archived design exports are excluded.
