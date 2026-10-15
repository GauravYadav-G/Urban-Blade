# Video reference — Urban Blade 2.5.1

Reference: `correctvi.mp4`, 1440×1080, 30fps, 24.83 seconds. Inspected a full-duration contact sheet at 0.5-second intervals and full-resolution frames.

## What the recording shows

- A floating, dark capsule navigation control over a pale, softly tinted interface.
- Rounded cards with quiet borders and a milky translucent lower surface.
- Cards expanding into focused task/details views, with short rise and defocus transitions.
- Small staggered content reveals and a bottom panel entering over the existing screen.
- A rotating 3D phone and an architectural scene with camera depth of field. That presentation blur is separate from the app's own material and motion.

## Implementation

Installed [gskinner/flutter_animate](https://github.com/gskinner/flutter_animate) through the published `flutter_animate` 4.5.2 package; locked in `pubspec.lock`.

- Shared `Entrance` uses package fade, move and blur effects with one owned controller. Sections rise 18 logical pixels, sharpen from sigma 3 (1.8 for horizontal product cards), and settle within 480ms. Blur reaches zero before the translation finishes. Animation frames reuse a repaint-isolated child.
- Retained tabs rise over 340ms when selected, while keeping drafts and scroll positions. Inactive tabs have tickers disabled; switching tabs does not fade an entire image-heavy viewport.
- Android page transitions rise into place and briefly defocus the departing page by up to sigma 2.5. The departing page scales to 98.2%. The temporary filter is removed when navigation settles. iOS retains native interactive back navigation and product Hero continuity.
- Shared glass uses clipped sigma-20 backdrop sampling with milky light and smoked dark tints. Contrast tests required a stronger light tint over black backgrounds; photo panels retain their protective tint.
- The floating navigation dock uses obsidian glass with champagne selection, maintaining semantic labels and 48px targets. Wide layouts cap the capsule at 440px.
- Cart sheets now have a transparent Material under the clipped frosted panel, allowing the background to contribute to the blur. The whole catalog is not continuously filtered.
- Reduced motion skips translation and defocus immediately. High contrast and accessible navigation use opaque glass surfaces.

The prior product alignment corrections and zoom removal remain. Existing commerce, account and booking operations are retained.

## Verification

New regression coverage checks that reveal filters disable after settling, animation frames do not rebuild reveal content, reduced motion is immediate, retained tab drafts survive, and Android defocus transitions return safely. Updated light/dark visual baselines were rendered and inspected. See the accompanying test-results report for final counts and builds.

This matches the recording's motion/material direction; it is not a pixel-for-pixel reproduction of the unrelated goals app or its 3D presentation. Real-device raster/build timings still require profiling on the target hardware.
