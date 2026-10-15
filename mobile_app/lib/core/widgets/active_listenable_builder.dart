import 'package:flutter/material.dart';

/// Retained tabs read fresh data when shown, without rebuilding hidden pages
/// for every cart sync, history refresh or payment notification.
class ActiveListenableBuilder extends StatefulWidget {
  final Listenable animation;
  final TransitionBuilder builder;
  final Widget? child;
  const ActiveListenableBuilder(
      {super.key, required this.animation, required this.builder, this.child});
  @override
  State<ActiveListenableBuilder> createState() =>
      _ActiveListenableBuilderState();
}

class _ActiveListenableBuilderState extends State<ActiveListenableBuilder> {
  bool _active = true;
  @override
  void initState() {
    super.initState();
    widget.animation.addListener(_changed);
  }

  void _changed() {
    if (_active) setState(() {});
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _active = TickerMode.of(context);
  }

  @override
  void didUpdateWidget(covariant ActiveListenableBuilder oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.animation != widget.animation) {
      oldWidget.animation.removeListener(_changed);
      widget.animation.addListener(_changed);
    }
  }

  @override
  void dispose() {
    widget.animation.removeListener(_changed);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.builder(context, widget.child);
}
