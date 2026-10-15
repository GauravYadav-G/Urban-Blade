# Appearance, restored home cards, and motion — 2.0.0 (13)

References: `home.mov`, `cart.mov`, and `anime.mov` in the workspace root.

Light is the default appearance. The header's moon/sun action switches immediately between light and dark. Profile exposes Light, Dark, and System; the choice is persisted separately from account/cart drafts. System follows the device appearance. Shared surfaces, text, controls, cart presentations, and system bars follow the selected theme.

The home screen retains the feature carousel, selection chips, booking shortcuts, product grid, service banner, category chips, and service list. Four tall image cards restore a two-column layout: At home, Salon visit, Our services, and Daily essentials. The booking cards preselect their location; the other two open the existing services and shop. Image category cards return alongside the category chips and apply the corresponding shop filter. Large text and narrow layouts can stack the tall cards for readability.

Motion drawn from `anime.mov`:
- Staggered slide/fade entrances for home/shop sections and product cards.
- Shared product-image Hero transitions into the detail route, with a subtle route scale/fade/slide.
- Existing press feedback, feature carousel, cart thumbnail flight, counter updates, shop cart reveal, and home cart sheet remain connected.
- Reduced-motion settings bypass entrance and route animations and preserve the previous reduced-motion behavior in cart and carousel controls.

Implementation:
- `core/theme/app_theme.dart` and `core/constants/app_colors.dart`: light/dark themes and contextual semantic colors.
- `core/services/app_state.dart` and `main.dart`: saved appearance selection and app-wide application.
- `core/widgets/entrance.dart`: one-shot staggered entrances without recurring timers.
- `features/home/home_editorial_cards.dart`: restored tall action cards and category cards.
- `test/appearance_motion_test.dart`: persistence, system appearance, navigation, card actions, theme screenshots, motion, and large-text coverage.

Reviewed previews include `appearance-home-light.png`, `appearance-home-dark.png`, `restored-home-cards.png`, `restored-home-cards-dark.png`, and `restored-home-categories.png` under `test/goldens/`.

Existing commerce and booking logic, routes, catalog, stored drafts, and previous APK artifacts are retained. Release packaging uses the project's existing signing configuration. On-device animation timing and real payment completion still require device validation.

Validation: `flutter analyze` reports no issues; all 48 Flutter tests pass, including the existing commerce, booking, account, and navigation regressions. Light and dark screenshots were rendered and visually inspected.
