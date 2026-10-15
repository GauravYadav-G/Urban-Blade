import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

/// A staggered rise, once per section. Blur is opt-in for small highlights;
/// scrolling cards avoid filtered textures during their entrance.
/// No timer or recurring animation: inactive tabs retain their state.
class Entrance extends StatefulWidget {
  final Widget child;
  final int order;
  final bool horizontal;
  final bool soften;
  const Entrance(
      {super.key,
      required this.child,
      this.order = 0,
      this.horizontal = false,
      this.soften = false});
  @override
  State<Entrance> createState() => _EntranceState();
}

class _EntranceState extends State<Entrance>
    with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(
      vsync: this, duration: const Duration(milliseconds: 480));
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _controller.value = 1;
      _started = true;
    } else if (!_started) {
      _started = true;
      _controller.forward();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduced = MediaQuery.disableAnimationsOf(context);
    final start = (widget.order * .07).clamp(0.0, .35);
    final curve = Interval(start, 1, curve: Curves.easeOutQuart);
    return Animate(
        controller: _controller,
        autoPlay: false,
        effects: [
          FadeEffect(
              begin: 0,
              end: 1,
              duration: const Duration(milliseconds: 480),
              curve: curve),
          MoveEffect(
              begin: Offset(
                  widget.horizontal ? 18 : 0, widget.horizontal ? 0 : 18),
              end: Offset.zero,
              duration: const Duration(milliseconds: 480),
              curve: curve),
          if (!reduced && widget.soften)
            BlurEffect(
                begin: Offset(
                    widget.horizontal ? 1.8 : 3, widget.horizontal ? 1.8 : 3),
                end: Offset.zero,
                duration: const Duration(milliseconds: 480),
                curve: Interval(start, .72, curve: Curves.easeOutCubic)),
        ],
        child: RepaintBoundary(child: widget.child));
  }
}

class EntranceSliver extends StatelessWidget {
  final Widget child;
  final int order;
  const EntranceSliver({super.key, required this.child, this.order = 0});
  @override
  Widget build(BuildContext context) =>
      SliverToBoxAdapter(child: Entrance(order: order, child: child));
}
