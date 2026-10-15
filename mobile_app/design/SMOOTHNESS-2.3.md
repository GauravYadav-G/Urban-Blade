# Urban Blade 2.3.0 (16)

The product cart retains the cart.mov collection reveal, curved product flight,
quantity animation, swipe opening and Back-to-collection behavior. Its cards now
use the same Material surfaces as Home's cart, including dark appearance. Home
and Shop share 420ms opening / 320ms closing durations. Home's layout and cart
sheet are preserved.

## Responsiveness

- MaterialApp rebuilds for appearance changes, rather than every cart/session update.
- Product-flight thumbnails keep a fixed decode size and animate their scale;
  the collection is a repaint boundary during the reveal.
- Shop filtering and sorting are cached outside build and refreshed for catalog,
  wishlist, search, category and sort changes.
- Native Cupertino route transitions are configured for Apple platforms;
  the current repository ships an Android app only.
- System Back closes an expanded cart first, returns secondary tabs to Home
  next, and permits exiting only from Home. Pushed routes retain normal Back.

## Services and payments

Services has a treatment category menu, searchable descriptions, compact service
cards, visible selection and a booking summary. Its selection never enters the
product cart.

Checkout offers UPI with PhonePe / Google Pay preferences using Razorpay's
standard checkout configuration and intent flow. Razorpay discovers installed
apps and performs the handoff; default methods remain available. Existing
server order creation, signature verification and pending-payment reconciliation
remain authoritative. No raw UPI payment links or client-declared success.

Order receipts and the checkout success screen expose a PDF download. The
Android document picker chooses the destination without broad storage permission.
PDF generation/writing runs on a worker, paginates long content, includes actual
payment status and handles cancellation/failure. Receipts use authenticated
order data and do not imply that pending/COD orders are paid.

Source: https://razorpay.com/docs/payments/payment-gateway/flutter-integration/standard/integration-steps/

## Verification and remaining device checks

Focused regressions cover cart Back priority, secondary tabs returning Home,
cart retention across themes, root rebuild isolation, service/cart separation,
UPI checkout order/amount/preferences, receipt contents and cancellation.
Visual references were refreshed and inspected for the current Home assets,
service redesign, themed cart surfaces and receipt download action.

No Android device or emulator was connected. Release-device frame metrics,
Android document-picker PDF export and live UPI handoff/return still require
on-device validation. Razorpay UPI intent availability depends on merchant
configuration and installed supported apps; no live charge was made.

Final automated results: 61 Flutter tests passed against the reviewed visual
baselines; flutter analyze reported no issues; guideline checks passed 15/15;
admin operations passed 49/49 with fixture teardown; Angular production build
passed. Android release compilation passed; the final APK is built from version
2.3.0+16.

## 2.3.1 (17): Android wallpaper colors

Material You now uses the Android-provided dynamic palette via
`dynamic_color` 1.9.x, compatible with this project's Flutter Material API.
Palette loading happens at launch, on resume from wallpaper settings, and on
platform brightness changes. Both light and dark themes use those colors,
including current Material surface roles. Unchanged palettes do not rebuild the
app; palette changes retain navigation and cart state. Unsupported devices keep
the existing brand palette, and transient platform failures retain the last
valid theme. Android's selected wallpaper/system palette is authoritative; no
wallpaper image or storage permission is needed.

The Home cart's surface resolves its color inside the live sheet builder so an
open sheet also updates. Cart thumbnails no longer change size or shape between
light and dark modes. Quantity controls, order filters, appointment surfaces and
Razorpay checkout accents now use semantic theme colors.

Tests mock the native Int32 palette payload, change it while the app is inactive,
resume, verify exact primary tones in both modes, and check that cart state and
thumbnail rectangles are unchanged. They also cover an already-open Home cart
and unsupported/error responses. Real-device wallpaper changes remain untested
because no device is connected.

Android support: https://developer.android.com/develop/ui/views/theming/dynamic-colors

2.3.1 verification: native release build succeeded; static analysis is clean;
wallpaper lifecycle tests pass for Home and Shop, with cart state and geometry
preserved. APK: `../UrbanBlade-2.3.1.apk`.
SHA-256: `de6041044cb12469a930cd22efed2e922e03a7f55974b76d31c64da46506de01`.
Final 2.3.1 regression run: all 63 Flutter tests passed, including screenshot
comparisons, dynamic palettes, cart retention and both UPI preferences.

## 2.3.2 (18): Shared cart sheet, receipt layout and Home card sizing

Home and Shop now use `CartSheetHost`, with the same background blur, 78% sheet
height, rounded corners, theme-aware surface, close gesture and animation timing.
The Shop dock and product-flight animation are retained. The latest requested
Home-style sheet replaces Shop's inline cart reveal. Obsolete navigation-bar
collapse state was removed; system Back dismisses the modal before returning Home.

Home's four care cards reserve equal text slots measured at the actual available
width and accessibility text scale. Wrapped titles, descriptions and actions now
align without clipping. Large text and narrow containers use one column.

Downloaded receipts now use an A4 PDF layout with embedded body type, a branded
header, actual payment status, aligned item and amount columns, delivery details,
totals, repeated table headers and page numbering. PDF generation runs in an
isolate; Android's existing document picker writes the resulting bytes off the
UI thread. Pending orders remain clearly marked as pending.

Validation includes nine card-layout cases (360, 393 and 412 logical pixels at
1.0, 1.3 and 1.6 text scales), cart/theme/back regressions and save cancellation.
Actual app-generated paid and six-page pending receipts were rendered and every
page visually reviewed. Light/dark cart and Home card snapshots were reviewed.
Physical OnePlus 8 rendering and Android document-picker saving still need a
connected-device check.

Final 2.3.2 verification: all 73 Flutter tests passed, static analysis clean,
guideline checks 15/15, admin checks 49/49 with fixture teardown, Angular build
and Android release build successful. APK: `../UrbanBlade-2.3.2.apk`.
SHA-256: `44be99074aff7064c71aaa64a6a9c6eb03bb21a60285e95f3b7c3d69290dde4a`.
