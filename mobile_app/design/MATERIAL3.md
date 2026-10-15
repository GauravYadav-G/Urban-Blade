# Material 3 — 2.2.0+15

The shared light and dark themes use a gold-seeded Material 3 color scheme with semantic foreground/background pairs. Light remains the default; Light, Dark and System preferences persist.

Native Material NavigationBar replaces the custom navigation rendering while retaining all five destinations, cart count, route keys, haptics and reduced-motion support. At large text sizes, icons retain accessible labels and tooltips. Cards, buttons, input fields, chips, dialogs, sheets and snackbars share the theme. Product add buttons have 48dp touch targets.

The tall 2×2 home actions, category cards, carousel, product and service sections, cart animations, booking, checkout and account routes are preserved. No dependencies were added.

Validation: 52 Flutter tests, including light/dark semantic color contrast (4.5:1), native navigation Android touch-target, label and text-contrast guidelines; existing narrow/landscape/large-text layouts, saved appearance, reduced motion, cart, booking and checkout regression coverage. Home screenshots reviewed in both modes. Flutter analysis is clean. Screenshot baselines updated for the intentional theme change.

Validation uses widget tests and local fixtures. Physical-device performance and live payment transactions have not been tested.
