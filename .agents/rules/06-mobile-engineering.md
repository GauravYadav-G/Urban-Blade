# 06. Mobile Engineering & Performance Standard (mobile-ai-agents)

> Derived from [salmanashraf/mobile-ai-agents](https://github.com/salmanashraf/mobile-ai-agents)

All mobile code (Flutter / Dart, React Native, iOS Swift, Android Kotlin) must comply with the following standards:

## 1. Widget Rebuild & Tree Optimization
- **Enforce Const Constructors**: Every widget and sub-tree whose parameters are compile-time constants must use `const` to avoid redundant widget instantiation on every frame.
- **Rebuild Scope Minimization**:
  - Scope `setState()` to the smallest possible sub-widget tree.
  - Avoid wrapping entire screens in high-frequency state builders (`Consumer`, `BlocBuilder`, `AnimatedBuilder`).
  - Extract inner static subtrees or pass them as `child` arguments to builders.
- **Avoid Expensive Work in `build()`**:
  - Never execute network queries, database lookups, or heavy collection filtering/sorting inside widget `build()` methods.
  - Memoize filtered and sorted collections using state fields, selectors, or view models.
  - Avoid allocating new closures or `Set` / `List` operations per frame in hot render paths.

## 2. Rendering & Layout Performance
- **Eliminate Redundant Layout Passes**:
  - Do not nest unnecessary `LayoutBuilder` widgets when dimensions or parent constraints are already known or passed via props.
  - Use `SizedBox` over `Container` when only dimensions (width/height) are constrained.
  - Virtualize lists with `ListView.builder` or `GridView.builder`; never use unbounded `Column` or unbounded `ListView(children: [...])` for dynamic or growing collections.
- **Image & Asset Optimization**:
  - Cache decoded network images (`CachedNetworkImage` / memory caching).
  - Specify `cacheWidth` and `cacheHeight` for resized raster images to avoid keeping large raw bitmaps in the image cache.
  - Wrap high-cost custom painted or animated items in `RepaintBoundary` to prevent unnecessary repainting of sibling trees.

## 3. Asynchronous Boundaries & Null Safety
- **Defensive Lifecycle Checks**:
  - Always check `if (!mounted) return;` before calling `setState()` or interacting with `BuildContext` across async gaps.
  - Ensure background tasks and streams cancel or dispose cleanly in `dispose()`.
- **Strict Typing**:
  - Avoid `dynamic` types; declare concrete models, records, and sealed classes.
  - Handle nullability cleanly without indiscriminate `!` bang operators.

## 4. In-Memory & Network Efficiency
- **Caching Layer**:
  - Implement in-memory TTL caching for read-only or infrequently updated remote resources (e.g., catalog, categories).
  - Prevent duplicate concurrent fetch requests for identical resources.
- **Zero UI Regression Guarantee**:
  - Performance and architecture optimizations must preserve pixel-perfect visual styling, colors, paddings, fonts, margins, animations, and interactive behaviors exactly as specified by the design system.
