import 'package:flutter/material.dart';

/// Builds pages on demand and retains drafts/scroll offsets without animating
/// opacity over an entire image-heavy screen. New selections rise into place.
class RetainedTabs extends StatefulWidget {
  final int index;
  final List<WidgetBuilder> builders;
  const RetainedTabs({super.key, required this.index, required this.builders});
  @override
  State<RetainedTabs> createState() => _RetainedTabsState();
}

class _RetainedTabsState extends State<RetainedTabs>
    with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(
      vsync: this, duration: const Duration(milliseconds: 340), value: 1);
  late final _curve =
      CurvedAnimation(parent: _controller, curve: Curves.easeOutQuart);
  late final _position =
      Tween<Offset>(begin: const Offset(0, .025), end: Offset.zero)
          .animate(_curve);
  bool _reducedMotion = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reducedMotion = MediaQuery.disableAnimationsOf(context);
    if (_reducedMotion) _controller.value = 1;
  }

  @override
  void didUpdateWidget(covariant RetainedTabs oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.index != widget.index && !_reducedMotion) {
      _controller.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _curve.dispose();
    _controller.dispose();
    super.dispose();
  }

  final Map<int, Widget> _pages = {};
  @override
  Widget build(BuildContext context) {
    _pages[widget.index] = widget.builders[widget.index](context);
    return Stack(
        fit: StackFit.expand,
        children: List.generate(
            widget.builders.length,
            (index) => Offstage(
                key: ValueKey(index),
                offstage: index != widget.index,
                child: ExcludeFocus(
                    excluding: index != widget.index,
                    child: TickerMode(
                        enabled: index == widget.index,
                        child: SlideTransition(
                            position: index == widget.index
                                ? _position
                                : const AlwaysStoppedAnimation(Offset.zero),
                            child: RepaintBoundary(
                                child: _pages[index] ??
                                    const SizedBox.shrink())))))));
  }
}
