# High-refresh validation

This release requests up to 120 Hz on Android at the current display resolution.
The OS, display capabilities, battery saver and thermal conditions still control
refresh rate. This is not a claim of measured 120 fps.

Rendering changes:
- Navigation and shared cards use pre-tinted materials with no live backdrop filter. The dock occupies its own layout region, so it cannot cover content or sticky actions.
- Tabs are created on first visit, retain their state, skip inactive rebuilds, and disable inactive tickers.
- Product, service and booking images decode at their bounded card width × device pixel ratio (capped at 1600 px), rather than defaulting to full screen width.
- Product cards and tab bodies have repaint boundaries; navigation uses one moving indicator. Full-screen tab fades and booking-step crossfades have been removed.
- Home product rows and the service catalog build lazily. Card press animations wait for intentional presses and cancel when dragging.
- Keyboard appearance hides the dock; large-text navigation uses icon targets with full semantic labels and tooltips.
- Reduced-motion preferences disable custom transitions.

Target reported by the user: Nothing Phone 3a. ADB device enumeration returned no connected devices during the 1.7.0 audit. Widget tests validate
behavior/layout, not GPU frame timing. Measure on a supported physical phone:

```sh
flutter run --profile --dart-define=FRAME_METRICS=true -d DEVICE_ID
```

After 60 warm-up frames, `urbanblade.frames` reports each 240 rendered frames:
build/raster p90 and p99 and frames exceeding 8.333 ms in either stage. Capture a
DevTools Performance trace too: CPU and GPU stages are pipelined, and these stage
metrics alone do not prove every frame reached the display on time.

Exercise cold launch, home/shop scroll, all tab switches, saved toggles, product
details, cart quantities, checkout, long order lists, and receipt sheets. Repeat
on a populated account and after the phone warms up. Check text scaling and
battery saver. Do not benchmark debug mode or infer phone performance from a
browser/emulator. Confirm the display is actually running at 120 Hz.
