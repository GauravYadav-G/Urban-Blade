# Mobile product detail repair — 2026-10-15

Changes:

- Removed the image enlargement button and zoom dialog.
- Gave Back, cart and saved-item controls equal 48px targets with centered icons.
- Centered the header title independently of the trailing action count; hides it when the available width or text scaling would crowd the controls.
- Scoped quantity and description updates to their controls and totals. Cart/saved-item notifications update header controls without rebuilding the product panel or photo.
- Deferred shell notification rebuilds while the product route covers the catalog; refreshes the shell when returning. Repeated taps cannot stack product routes.
- Removed the Android 120Hz refresh preference ceiling. Requests the highest supported rate at the current resolution, with battery saver and OS policy retained.
- Profile frame metrics now use the display's reported refresh rate instead of a hardcoded 120Hz budget.

Verification:

- Full Flutter suite: 164 passed.
- Final product, navigation, payment and rendering regressions: 17 passed after the shell optimization.
- Flutter analyzer: no issues.
- Android release APK: built successfully (136.9MB), copied to `UrbanBlade-2.5.0.apk`.
- Light/dark product previews rendered and visually inspected; golden images updated for the requested changes.
- Guidelines: 15/15 passed.
- Admin operations: 49/49 passed; fixtures cleaned up by the test runner.
- Angular production build: passed. Restricted runs crashed in esbuild; the build completed with approved sandbox escalation.

Device performance has not been measured. No 340 FPS claim is made. Run `flutter run --profile --dart-define=FRAME_METRICS=true` on the target physical device to measure build/raster percentiles against its refresh-rate budget.
