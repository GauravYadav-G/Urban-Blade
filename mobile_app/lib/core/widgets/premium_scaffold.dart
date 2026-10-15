import 'dart:async';
import 'package:flutter/material.dart';

/// Static amber and slate light washes give frosted surfaces visible depth.
/// The background never drives a ticker or repaints in response to scrolling.
class Atmosphere extends StatelessWidget {
  final Widget child;
  const Atmosphere({super.key, required this.child});
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final plain = MediaQuery.highContrastOf(context) ||
        MediaQuery.accessibleNavigationOf(context);
    return ColoredBox(
        color: scheme.surface,
        child: CustomPaint(
            painter: plain ? null : _AtmospherePainter(scheme), child: child));
  }
}

class _AtmospherePainter extends CustomPainter {
  final ColorScheme scheme;
  const _AtmospherePainter(this.scheme);

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    final dark = scheme.brightness == Brightness.dark;
    void wash(Offset center, double radius, Color color) {
      final bounds = Rect.fromCircle(center: center, radius: radius);
      canvas.drawCircle(
          center,
          radius,
          Paint()
            ..shader = RadialGradient(colors: [
              color,
              color.withValues(alpha: 0),
            ]).createShader(bounds));
    }

    canvas.save();
    canvas.clipRect(Offset.zero & size);
    wash(Offset(size.width * .94, size.height * .10), size.width * .94,
        const Color(0xFFF59E0B).withValues(alpha: dark ? .105 : .13));
    wash(Offset(size.width * -.18, size.height * .47), size.width * .90,
        const Color(0xFF64748B).withValues(alpha: dark ? .18 : .13));
    wash(Offset(size.width * .85, size.height * .99), size.width * .70,
        const Color(0xFFF59E0B).withValues(alpha: dark ? .065 : .085));
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _AtmospherePainter oldDelegate) =>
      oldDelegate.scheme != scheme;
}

class PremiumScaffold extends StatelessWidget {
  final PreferredSizeWidget? appBar;
  final Widget? body, bottomNavigationBar;
  final bool extendBody;
  final Color? backgroundColor;
  const PremiumScaffold(
      {super.key,
      this.appBar,
      this.body,
      this.bottomNavigationBar,
      this.extendBody = false,
      this.backgroundColor});
  @override
  Widget build(BuildContext context) => Atmosphere(
      child: Scaffold(
          backgroundColor: backgroundColor ?? Colors.transparent,
          appBar: appBar,
          extendBody: extendBody,
          body: HeroMode(
              enabled: !MediaQuery.disableAnimationsOf(context),
              child: body ?? const SizedBox()),
          bottomNavigationBar: bottomNavigationBar));
}

/// Adds tactile feedback without taking over a child's tap or scroll gestures.
class PressScale extends StatefulWidget {
  final Widget child;
  const PressScale({super.key, required this.child});
  @override
  State<PressScale> createState() => _PressScaleState();
}

class _PressScaleState extends State<PressScale> {
  bool _pressed = false;
  Timer? _pressDelay;
  Offset? _origin;
  void _release() {
    _pressDelay?.cancel();
    _origin = null;
    if (_pressed) setState(() => _pressed = false);
  }

  @override
  void dispose() {
    _pressDelay?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Listener(
      onPointerDown: (e) {
        _origin = e.position;
        _pressDelay?.cancel();
        if (!MediaQuery.disableAnimationsOf(context)) {
          _pressDelay = Timer(const Duration(milliseconds: 90), () {
            if (mounted && _origin != null) setState(() => _pressed = true);
          });
        }
      },
      onPointerUp: (_) => _release(),
      onPointerCancel: (_) => _release(),
      onPointerMove: (e) {
        if (_origin != null && (e.position - _origin!).distance > 8) _release();
      },
      child: AnimatedScale(
          scale:
              _pressed && !MediaQuery.disableAnimationsOf(context) ? .985 : 1,
          duration: MediaQuery.disableAnimationsOf(context)
              ? Duration.zero
              : Duration(milliseconds: _pressed ? 100 : 240),
          curve: _pressed ? Curves.easeOutCubic : Curves.easeOutQuart,
          child: widget.child));
}

class SuccessSeal extends StatelessWidget {
  const SuccessSeal({super.key});
  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
      tween: Tween(
          begin: MediaQuery.disableAnimationsOf(context) ? 1 : .86, end: 1),
      duration: MediaQuery.disableAnimationsOf(context)
          ? Duration.zero
          : const Duration(milliseconds: 480),
      curve: Curves.easeOutBack,
      builder: (context, value, child) =>
          Transform.scale(scale: value, child: child),
      child: Container(
          width: 102,
          height: 102,
          decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    Color(0xFFD8E3D0),
                    Color(0xFFF8FAF2),
                    Color(0xFFC5D3BA)
                  ]),
              border: Border.all(color: Colors.white, width: 2),
              boxShadow: const [
                BoxShadow(
                    color: Color(0x44748A61),
                    blurRadius: 32,
                    offset: Offset(0, 10)),
                BoxShadow(
                    color: Color(0x20FFFFFF), blurRadius: 3, spreadRadius: 4)
              ]),
          child: const Icon(Icons.check_rounded,
              size: 48, color: Color(0xFF1D1D1F))));
}
