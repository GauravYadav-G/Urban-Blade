---
name: mobile-ai-agents
description: Complete mobile AI engineering toolkit for Flutter, React Native, iOS, Android, and cross-platform apps based on salmanashraf/mobile-ai-agents. Provides specialized review patterns for Dart/Flutter widget rebuilds, layout profiling, memory efficiency, const optimization, and network caching while preserving pixel-perfect UI.
---

# Mobile AI Agents Toolkit

Based on [salmanashraf/mobile-ai-agents](https://github.com/salmanashraf/mobile-ai-agents), this skill equips AI assistants with deep mobile engineering capabilities across Flutter, iOS, Android, and cross-platform runtimes.

## Key Agents & Workflows

### 1. Flutter & Dart Specialists
- **`dart`**: Pixel-perfect widget auditor that counts rebuilds, enforces `const`, flags unnecessary `setState()`, and audits lifecycle safety.
- **`flutter-review`**: Audits widget tree depth, rebuild scopes, un-memoized list transforms, and Dart 3.x patterns.
- **`widget-extract`**: Refactors monolithic widgets into cohesive, lightweight `StatelessWidget` sub-components without changing appearance.
- **`bloc-feature-builder`**: Scaffolds test-driven BLoC and state management patterns.

### 2. Performance & Memory Audits
- **`perf-audit`**: Profiling checklist for 60/120 FPS rendering, frame budget compliance (< 16ms), overdraw elimination, and avoiding main-thread disk/network bottlenecks.
- **`clean-code-audit`**: Architecture and clean code verification.
- **`security-audit`**: Mobile token storage, secure storage, and API surface review.

## Flutter Optimization Checklist

When optimizing a Flutter app without altering the UI:
1. **Zero UI Change**: Do not alter padding, colors, fonts, margins, shapes, animations, or layout geometry.
2. **Const Propagation**: Add `const` to all static widgets, EdgeInsets, TextStyle, and BoxDecorations.
3. **Avoid Redundant LayoutBuilder**: Use known parent constraints or explicit width/height props rather than nesting expensive `LayoutBuilder` passes.
4. **Memoize Hot Computations**: Never sort or filter lists in `build()`. Compute once in state or memoized getters.
5. **Decoded Image Cache**: Bound image cache sizes with `cacheWidth` / `cacheHeight` on `ResizeImage` or network image providers.
6. **In-Memory Network Caching**: Cache idempotent API responses (such as product categories and catalog services) with a short TTL.
