# Liquid glass source attribution

This Flutter implementation adapts rendering techniques and shader functions from:

- **mkj0kjay/vue-web-liquid-glass**, revision
  `934404c05167417945e73a36388c20cc201b5a55`.
  https://github.com/mkj0kjay/vue-web-liquid-glass
  `src/lib/surfaceEquations.ts` (convex squircle),
  `src/lib/displacementMap.ts` (surface derivative and Snell displacement),
  `src/lib/specular.ts` (directional specular), and
  `src/components/LiquidGlassContainer.vue` (translucent layers).
  The upstream README declares MIT; its repository has no standalone LICENSE.
  The MIT permission text is reproduced in `LICENSE.vue-web-liquid-glass`.
  Upstream credits https://kube.io/blog/liquid-glass-css-svg/ for its research.
- **SilentEaves/LiquidGlass-Cpp**, revision
  `b7df81d8f8ed9eec718427afb46a6ed51c7ba46d`.
  https://github.com/SilentEaves/LiquidGlass-Cpp
  `Shaders.cpp` (rounded-box field and normal, lensCurve, spectral sampling and
  directional edge lighting). Apache-2.0. Copyright 2026 默檐.
  Its core derives from **Kyant0/AndroidLiquidGlass**, Copyright 2025 Kyant.
  The unmodified upstream LICENSE and NOTICE accompany this file.

Flutter-specific modifications: single-surface GLSL runtime shader; direct
engine backdrop sampling; analytic convex derivative replacing SVG bitmaps;
three spectral samples; bounded mobile lens displacement; native blur composition;
premultiplied alpha; theme tint; directional Canvas rim and software fallback;
per-widget shader lifetime with a shared program cache. No Vue browser runtime,
OpenGL context, ImGui layer, or native C++ dependency is added to the application.

The port lives in `shaders/repository_liquid_glass.frag` and
`lib/core/widgets/repository_glass.dart`. Licenses are bundled as application
assets and registered with Flutter's license registry.
