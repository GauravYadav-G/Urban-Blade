# Urban Blade 2.5.2 (22)

## Approved home design

Implemented the personal dashboard from `design-previews/urban-blade-home-options-02.png`: an amber service-booking tile, aligned studio/home cards, a next-visit booking shortcut, daily essentials, and image categories. The home search bar and carousel are removed. Product search remains in Shop. Both appearance modes retain the 2.5.1 palette and navigation. Narrow screens and large accessibility text stack the dashboard cards.

Actual rendered screens are saved in `design-previews/urban-blade-2.5.2-home-light.png` and `design-previews/urban-blade-2.5.2-home-dark.png`.

## Rendering work reduced

- MainShell retains stable catalog widget instances when cart badges or history change. Each catalog subscribes only to relevant state; booking drafts and pending-payment availability still refresh.
- Hidden Profile defers notification-driven builds until active. Retained tabs suppress inactive tickers and preserve scroll/drafts.
- Android route transitions use compositor translation/scale without a full-screen image filter. List/card entrances use fade/move; blur is opt-in for small elements. Reduced motion remains supported.
- Nested glass controls share the containing sheet's backdrop pass. Independent sheets retain their own clipped sampling region.
- Product images keep bounded decode widths and caching; product quantity/save interactions preserve the photo subtree. Product zoom remains removed.
- Checkout progress animates only a small isolated status area and switches between progress labels.

Regression tests check stable home/service widget identities during cart mutations, hidden page rebuild suppression, a single backdrop pass for nested frosted controls, lazy booking lists, dashboard alignment at multiple widths/text scales, and reduced-motion behavior. These are structural checks, not measurements of phone FPS.

## Android UPI recovery

The installed Razorpay Flutter SDK exposes an async-void launch API. Its asynchronous native-channel errors escaped a conventional try/catch and could leave the checkout future unresolved. A guarded asynchronous boundary now returns an actionable failure, prevents concurrent launches, supports retries, and completes pending work when disposed.

On app resume while checkout owns an attempt, the app reconciles server status without opening another checkout. Failed or cancelled callbacks preserve the pending server order and check status before allowing a retry. Only server verification confirms an order.

Android package visibility covers the supported Google Pay, PhonePe, Paytm and BHIM apps and browsable UPI links. Preferred app selection is passed to Razorpay's supported display configuration with other payment methods available. No direct unverified UPI transfer path was added.

Real UPI intent requires a live merchant order and a compatible installed app. Test-mode orders now explain the limitation and offer standard online checkout. No credentials were changed and no purchase was made.

References: [Razorpay Flutter integration](https://github.com/razorpay/markdown-docs/blob/master/payments/payment-gateway/flutter-integration/standard/integration-steps.md), [checkout configuration](https://d6xcmfyh68wv8.cloudfront.net/docs/payments/payment-gateway/web-integration/standard/configure-payment-methods/understand-configuration/). The user's [awesome-flutter collection](https://github.com/Solido/awesome-flutter) supplied design exploration references; no unrelated app repository was installed into this codebase.

## Verification and remaining device checks

Flutter analysis passed with no issues; all 176 mobile tests passed. Repository guidelines passed 15 checks, admin verification passed 49 operations, and the web production build passed. Logs are recorded alongside this report. The release APK is `UrbanBlade-2.5.2.apk` at the repository root, with verified versionName `2.5.2` and versionCode `22`. The existing local-testing signing configuration is retained.

APK SHA-256: `2415b06471e0bda43fefb93ca044fea3294e9b313c358c430b128ed73da159d2`.

No physical Android device was connected: discovered targets were macOS and Chrome. Low-end frame pacing, thermal behavior, live merchant configuration, and actual Google Pay/PhonePe handoff remain unverified on hardware. A fixed FPS claim would be unsupported.

To profile on a low-end Android phone, use `flutter run --profile --dart-define=FRAME_METRICS=true`, then scroll Home/Shop, open products, add/remove cart items, switch tabs, and return from checkout. After warmup, `urbanblade.frames` reports build/raster p90/p99 and over-budget frames against the display's reported refresh rate. Repeat with battery saver and reduced motion enabled. No performance measurements were fabricated for this release.
