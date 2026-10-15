import 'dart:ui';
import 'package:flutter/material.dart';
import 'repository_glass.dart';

/// A tinted glass surface. Live frost is opt-in for bounded chrome and sheets;
/// scrolling cards use the same reflective material without a backdrop pass.
class GlassPanel extends StatelessWidget {
  final Widget child;
  final double radius;
  final bool blur;

  /// Real refraction on supported renderers; bounded frosted fallback elsewhere.
  /// Reserve for the dashboard and navigation, rather than every catalog row.
  final bool liquid;

  /// Obsidian glass for the floating dock shown in the reference video.
  final bool ink;

  /// Stronger tint preserves text contrast over photography without a blur pass.
  final bool overImage;
  final EdgeInsetsGeometry padding;
  final Color? tint;
  const GlassPanel({
    super.key,
    required this.child,
    this.radius = 20,
    this.blur = false,
    this.liquid = false,
    this.ink = false,
    this.overImage = false,
    this.padding = EdgeInsets.zero,
    this.tint,
  });
  static const shadows = [
    BoxShadow(color: Color(0x0C152036), blurRadius: 20, offset: Offset(0, 7)),
  ];

  /// Ink includes this border in its content inset; measured captions share it.
  static double borderWidthOf(BuildContext context) =>
      MediaQuery.highContrastOf(context) ||
          MediaQuery.accessibleNavigationOf(context)
      ? 1.25
      : 1;
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final dark = ink || scheme.brightness == Brightness.dark;
    final opaque =
        MediaQuery.highContrastOf(context) ||
        MediaQuery.accessibleNavigationOf(context);
    final strongTint = blur || overImage;
    final accent = tint ?? scheme.surfaceContainerLow;
    final base = ink
        ? const Color(0xFF0B0F19)
        : Color.alphaBlend(
            accent.withValues(alpha: tint == null ? .12 : .16),
            dark ? scheme.surfaceContainerHigh : scheme.surfaceContainerLowest,
          );
    final inheritedFrost =
        context.dependOnInheritedWidgetOfExactType<_GlassBlurScope>() != null;
    if (liquid && !opaque && !inheritedFrost) {
      return _liquidSurface(context, base, dark);
    }
    final decoration = BoxDecoration(
      color: opaque
          ? (ink ? const Color(0xFF0B0F19) : scheme.surfaceContainerLow)
          : null,
      gradient: opaque
          ? null
          : LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              stops: const [0, .48, 1],
              colors: [
                Color.alphaBlend(
                  Colors.white.withValues(alpha: dark ? .04 : .12),
                  base,
                ).withValues(
                  alpha: blur
                      ? (dark ? .88 : .93)
                      : (strongTint ? .94 : (dark ? .88 : .90)),
                ),
                base.withValues(
                  alpha: blur
                      ? (dark ? .80 : .88)
                      : (strongTint ? .90 : (dark ? .80 : .76)),
                ),
                Color.alphaBlend(
                  accent.withValues(alpha: .06),
                  base,
                ).withValues(
                  alpha: blur
                      ? (dark ? .85 : .91)
                      : (strongTint ? .92 : (dark ? .86 : .84)),
                ),
              ],
            ),
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(
        color: opaque
            ? scheme.outline
            : Color.alphaBlend(
                Colors.white.withValues(alpha: dark ? .22 : .76),
                scheme.outlineVariant.withValues(alpha: dark ? .35 : .52),
              ),
        width: borderWidthOf(context),
      ),
    );
    Widget surface = Material(
      color: Colors.transparent,
      child: Ink(
        decoration: decoration,
        child: Padding(padding: padding, child: child),
      ),
    );
    if (blur && !opaque && !inheritedFrost) {
      // Separate keys keep nested/overlapping modal surfaces independent.
      surface = BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
        child: _GlassBlurScope(child: surface),
      );
    }
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        boxShadow: opaque
            ? const []
            : [
                BoxShadow(
                  color: Colors.black.withValues(alpha: dark ? .15 : .045),
                  blurRadius: 22,
                  offset: const Offset(0, 7),
                ),
              ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(radius),
        child: surface,
      ),
    );
  }

  Widget _liquidSurface(BuildContext context, Color base, bool dark) {
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: dark ? .16 : .045),
            blurRadius: 18,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: RepositoryGlass(
        radius: radius,
        tint: base.withValues(alpha: dark ? .52 : .60),
        child: _GlassBlurScope(
          child: Material(
            color: Colors.transparent,
            child: Ink(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(radius),
                border: Border.all(color: Colors.transparent),
              ),
              child: Padding(padding: padding, child: child),
            ),
          ),
        ),
      ),
    );
  }
}

/// Descendant glass chrome shares the containing sheet's sampled backdrop.
/// Overlapping sheets still receive their own independent sampling pass.
class _GlassBlurScope extends InheritedWidget {
  const _GlassBlurScope({required super.child});
  @override
  bool updateShouldNotify(_GlassBlurScope oldWidget) => false;
}
