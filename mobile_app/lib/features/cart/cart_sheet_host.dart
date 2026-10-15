import 'package:flutter/material.dart';
import '../../core/services/app_state.dart';
import '../../core/widgets/glass_panel.dart';
import '../../core/widgets/commerce_ui.dart';
import 'cart_flow.dart';
import 'cart_screen.dart';

/// Shared by Home and Shop, so sheet geometry, blur and theme updates agree.
class CartSheetHost extends StatefulWidget {
  final AppState state;
  final Widget child;
  final VoidCallback onCheckout;
  final Key? surfaceKey;
  const CartSheetHost(
      {super.key,
      required this.state,
      required this.child,
      required this.onCheckout,
      this.surfaceKey});
  @override
  State<CartSheetHost> createState() => CartSheetHostState();
}

class CartSheetHostState extends State<CartSheetHost> {
  bool _visible = false;
  ModalRoute<void>? _route;

  void close() {
    final route = _route;
    if (route != null && route.isCurrent) route.navigator?.pop();
  }

  Future<void> open() async {
    if (_visible) return;
    setState(() => _visible = true);
    try {
      await showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          useSafeArea: true,
          backgroundColor: Colors.transparent,
          barrierColor: Colors.black.withValues(alpha: .32),
          clipBehavior: Clip.antiAlias,
          sheetAnimationStyle: MediaQuery.disableAnimationsOf(context)
              ? AnimationStyle.noAnimation
              : const AnimationStyle(
                  duration: cartOpenDuration,
                  reverseDuration: cartCloseDuration),
          shape: const RoundedRectangleBorder(
              borderRadius: BorderRadius.vertical(top: Radius.circular(26))),
          builder: (sheetContext) {
            _route = ModalRoute.of<void>(sheetContext);
            final theme = Theme.of(sheetContext);
            final keyboard = MediaQuery.viewInsetsOf(sheetContext).bottom;
            return LayoutBuilder(builder: (context, constraints) {
              final availableHeight = (constraints.maxHeight - keyboard)
                  .clamp(0.0, double.infinity);
              final height = (MediaQuery.sizeOf(sheetContext).height * .78)
                  .clamp(0.0, availableHeight);
              return Material(
                  key: widget.surfaceKey,
                  color: Colors.transparent,
                  child: GlassPanel(
                      radius: 26,
                      blur: true,
                      child: Padding(
                          padding: EdgeInsets.only(bottom: keyboard),
                          child: SizedBox(
                              height: height,
                              child: Column(children: [
                                Padding(
                                    padding:
                                        EdgeInsets.all(height < 200 ? 4 : 12),
                                    child: CommerceSheetHeader(
                                        title: 'My cart',
                                        closeTooltip: 'Close cart',
                                        icon: Icons.shopping_bag_outlined,
                                        compact: height < 200,
                                        onClose: () =>
                                            Navigator.pop(sheetContext))),
                                Expanded(
                                    child: CartScreen(
                                        state: widget.state,
                                        dark:
                                            theme.brightness == Brightness.dark,
                                        showHeading: false,
                                        cardSurfaces: true,
                                        onContinueShopping: () =>
                                            Navigator.pop(sheetContext),
                                        onProceedToCheckout: () {
                                          Navigator.pop(sheetContext);
                                          widget.onCheckout();
                                        })),
                              ])))));
            });
          });
    } finally {
      _route = null;
      if (mounted) setState(() => _visible = false);
    }
  }

  @override
  Widget build(BuildContext context) => RepaintBoundary(child: widget.child);
}
