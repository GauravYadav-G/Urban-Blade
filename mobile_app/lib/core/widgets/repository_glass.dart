import 'dart:math' as math;
import 'dart:ui' as ui;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Flutter port of the Vue convex bezel and C++ lens / spectral glass models.
/// Source revisions and licenses live in third_party/liquid_glass/NOTICE.md.
/// Only the background is filtered; text and touch targets stay undistorted.
class RepositoryGlass extends StatefulWidget {
  final Widget child;
  final double radius;
  final Color tint;
  const RepositoryGlass({
    super.key,
    required this.child,
    required this.radius,
    required this.tint,
  });

  @override
  State<RepositoryGlass> createState() => _RepositoryGlassState();
}

class _RepositoryGlassState extends State<RepositoryGlass> {
  static Future<ui.FragmentProgram?>? _program;
  ui.FragmentShader? _shader;

  static Future<ui.FragmentProgram?> _loadProgram() async {
    try {
      return await ui.FragmentProgram.fromAsset(
        'shaders/repository_liquid_glass.frag',
      );
    } catch (error) {
      if (kDebugMode) {
        debugPrint('Glass shader unavailable; using frost: $error');
      }
      return null;
    }
  }

  @override
  void initState() {
    super.initState();
    if (ui.ImageFilter.isShaderFilterSupported) _prepareShader();
  }

  Future<void> _prepareShader() async {
    final program = await (_program ??= _loadProgram());
    if (!mounted || program == null) return;
    setState(() => _shader = program.fragmentShader());
  }

  @override
  void dispose() {
    _shader?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dpr = MediaQuery.devicePixelRatioOf(context);
    final shader = _shader;
    ui.ImageFilter filter = ui.ImageFilter.blur(sigmaX: 3, sigmaY: 3);
    if (shader != null && ui.ImageFilter.isShaderFilterSupported) {
      shader
        ..setFloat(2, widget.radius * dpr)
        ..setFloat(3, math.min(12.0, widget.radius * .55) * dpr)
        ..setFloat(4, 14 * dpr)
        ..setFloat(5, 1.5)
        ..setFloat(6, .035)
        ..setFloat(7, widget.tint.r)
        ..setFloat(8, widget.tint.g)
        ..setFloat(9, widget.tint.b)
        ..setFloat(10, widget.tint.a);
      filter = ui.ImageFilter.compose(
        outer: ui.ImageFilter.shader(shader),
        inner: filter,
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(widget.radius),
      child: BackdropFilter(
        filter: filter,
        child: CustomPaint(
          foregroundPainter: _SpecularRim(widget.radius),
          child: DecoratedBox(
            decoration: BoxDecoration(
              // Shader already applies tint. The fallback mirrors Vue's 60%
              // translucent layer and its opposing specular rim.
              color: shader != null && ui.ImageFilter.isShaderFilterSupported
                  ? Colors.transparent
                  : widget.tint,
              borderRadius: BorderRadius.circular(widget.radius),
            ),
            child: widget.child,
          ),
        ),
      ),
    );
  }
}

/// A directional rim also keeps the material recognizable on software renderers.
class _SpecularRim extends CustomPainter {
  final double radius;
  const _SpecularRim(this.radius);
  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    final rect = (Offset.zero & size).deflate(.7);
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2
      ..shader = const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        stops: [0, .25, .48, .72, 1],
        colors: [
          Color(0xE6FFFFFF),
          Color(0x33FFFFFF),
          Color(0x05708090),
          Color(0x33FFFFFF),
          Color(0xA6FFFFFF),
        ],
      ).createShader(rect);
    canvas.drawRRect(
      RRect.fromRectAndRadius(rect, Radius.circular(radius)),
      paint,
    );
    final inner = rect.deflate(1.5);
    if (inner.width > 0 && inner.height > 0) {
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          inner,
          Radius.circular(math.max(0.0, radius - 1.5)),
        ),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = .5
          ..color = const Color(0x16708090),
      );
    }
  }

  @override
  bool shouldRepaint(_SpecularRim oldDelegate) => oldDelegate.radius != radius;
}
