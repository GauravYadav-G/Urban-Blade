# Urban Blade 2.5.3+23 — repository glass port and home/nav repair

## Result

The home dashboard now follows the same semantic theme colors and typography as
the rest of the app. The top bar uses a left-aligned URBAN / BLADE editorial
wordmark, a slim accent rule, and independent glass profile/cart controls on the
right. Its light/dark toggle is removed; appearance selection remains in Profile.
The bottom dock retains route semantics, badges, safe areas, keyboard behavior,
48px targets and reduced-motion handling, with theme-aware glass and clean icons.

## Requested repository implementation

- Vue source: https://github.com/mkj0kjay/vue-web-liquid-glass at
  `934404c05167417945e73a36388c20cc201b5a55`.
- C++ source: https://github.com/SilentEaves/LiquidGlass-Cpp at
  `b7df81d8f8ed9eec718427afb46a6ed51c7ba46d`.
- `mobile_app/shaders/repository_liquid_glass.frag` combines the Vue convex
  squircle derivative / Snell displacement with the C++ rounded-box distance,
  edge normal, lens curve, spectral sampling and directional rim.
- `RepositoryGlass` applies the port as a bounded background shader on supported
  Impeller backends. Text and touch controls remain separate. A native blur plus
  translucent tint and directional rim is used on unsupported renderers or if
  shader loading fails. High contrast and accessible navigation remain opaque.
- The program is cached; individual shaders are disposed with their widget.
  Nested glass shares its containing frost scope. Long catalog lists keep their
  lighter material rather than allocating a new backdrop shader per row.
- The source repositories are adapted to Flutter; Vue/DOM and OpenGL/ImGui are
  not runtime dependencies. The earlier renderer dependency has been removed.
- Source credits, the original C++ Apache license/NOTICE, and Vue MIT permission
  text are in `mobile_app/third_party/liquid_glass/`, bundled as app assets and
  registered with Flutter's license registry. See NOTICE.md for exact provenance.

## Other reliability fixes

- Added awesome-flutter's `flutter_svg` entry for SVG-only bundled images and
  remote SVG URLs, including query strings. Existing local JPG variants retain
  priority. Local fallback paths are normalized; missing fallbacks show the
  branded tile. Bitmap caching and bounded decoding remain.
- Availability rejects malformed payloads and non-string / blank time values
  with an actionable error. Valid empty days remain empty. Valid times are
  trimmed and deduplicated in server order.
- Connection errors no longer claim all failed requests were saved locally and
  advise checking order/payment status before resubmitting.
- Declared minimums: Dart 3.9 and Flutter 3.35 (for flutter_svg).

## Verification

- The real GLSL was compiled and rendered against a synthetic color image.
  Its pixel test confirms inward refraction on both edges, center preservation,
  opaque interior and rounded transparent corners.
- Baseline generation and the final comparison run passed all 186 tests, including small/landscape layouts,
  enlarged text, contrast, cart/booking flows and appearance persistence.
- Reviewed the final light and dark home previews. Software widget goldens
  exercise the frosted fallback, not an Impeller backdrop.
- `flutter analyze`: passed, no issues.
- Android release build: passed (68.7 seconds), producing `UrbanBlade-2.5.3.apk`.
  Inspected the APK archive and confirmed the compiled shader and all four
  license/notice assets are present.
- `npm run test:guidelines`: passed, 15 checks.
- `npm run test:admin`: passed, 49 operations; fixtures cleaned up.
- `npm run build`: passed.

No Android device was connected, and the iOS simulator utility was unavailable.
Native backdrop alignment and GPU performance still require physical-device
verification. The APK uses the existing debug signing configuration for local
installation, not store distribution.
