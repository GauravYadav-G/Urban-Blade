import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/models/product_model.dart';
import '../../core/services/app_state.dart';
import '../../core/widgets/stitch_image.dart';
import 'cart_screen.dart';

// Shared with Home's cart sheet; the reference reveal and flight paths stay intact.
const cartOpenDuration = Duration(milliseconds: 420);
const cartCloseDuration = Duration(milliseconds: 320);

const cartInk = Color(0xFF101110);
const cartYellow = Color(0xFFFFCC4D);

/// A single surface: the collection slides away to reveal the bag underneath.
class CartFlow extends StatefulWidget {
  final AppState state;
  final Widget child;
  final VoidCallback onCheckout;
  final ValueChanged<bool>? onExpanded;
  final VoidCallback? onOpenCart;
  final bool showEmptyDock;
  final Color? catalogColor;
  const CartFlow(
      {super.key,
      required this.state,
      required this.child,
      required this.onCheckout,
      this.onExpanded,
      this.onOpenCart,
      this.showEmptyDock = true,
      this.catalogColor});

  @override
  State<CartFlow> createState() => CartFlowState();
}

class CartFlowState extends State<CartFlow> with TickerProviderStateMixin {
  late final _reveal = AnimationController(
      vsync: this,
      duration: cartOpenDuration,
      reverseDuration: cartCloseDuration);
  late final _flight = AnimationController(
      vsync: this, duration: const Duration(milliseconds: 560));
  final _stage = GlobalKey();
  final _landing = GlobalKey();
  bool _expanded = false;
  ProductModel? _flyingProduct;
  Offset _from = Offset.zero, _to = Offset.zero;

  void open() {
    if (widget.onOpenCart != null) {
      widget.onOpenCart!();
      return;
    }
    _setExpanded(true);
  }

  void close() => _setExpanded(false);

  void _setExpanded(bool value) {
    if (_expanded == value) return;
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() => _expanded = value);
    widget.onExpanded?.call(value);
    if (MediaQuery.disableAnimationsOf(context)) {
      _reveal.value = value ? 1 : 0;
    } else if (value) {
      _reveal.forward();
    } else {
      _reveal.reverse();
    }
  }

  void add(ProductModel product, Offset globalOrigin) {
    if (!product.inStock || widget.state.pendingPayment != null) return;
    widget.state.addToCart(product);
    HapticFeedback.lightImpact();
    if (MediaQuery.disableAnimationsOf(context)) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _animateProduct(product, globalOrigin);
    });
  }

  void _animateProduct(ProductModel product, Offset globalOrigin) {
    final stage = _stage.currentContext?.findRenderObject() as RenderBox?;
    final landing = _landing.currentContext?.findRenderObject() as RenderBox?;
    if (stage == null || landing == null) return;
    _from = stage.globalToLocal(globalOrigin);
    final count = math.min(widget.state.cart.length, 3);
    if (count == 0) return;
    final index = widget.state.cart
        .indexWhere((item) => item.product.id == product.id)
        .clamp(0, count - 1);
    final slot = math.min(42.0, landing.size.width / count);
    _to = stage.globalToLocal(landing.localToGlobal(
        Offset(slot * (index + .5) - 3, landing.size.height / 2)));
    setState(() => _flyingProduct = product);
    _flight.forward(from: 0);
  }

  @override
  void dispose() {
    _reveal.dispose();
    _flight.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => PopScope(
      canPop: !_expanded,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) close();
      },
      child: AnimatedBuilder(
          animation: widget.state,
          builder: (context, _) =>
              LayoutBuilder(builder: (context, constraints) {
                final showDock =
                    widget.showEmptyDock || widget.state.cartCount > 0;
                final dockHeight = showDock
                    ? 82.0 + MediaQuery.paddingOf(context).bottom
                    : 0.0;
                final catalogHeight =
                    math.max(0.0, constraints.maxHeight - dockHeight);
                return ColoredBox(
                    color: Colors.transparent,
                    child: Stack(
                        fit: StackFit.expand,
                        key: _stage,
                        clipBehavior: Clip.hardEdge,
                        children: [
                          Positioned.fill(
                              top: 60,
                              child: AnimatedBuilder(
                                  animation: _reveal,
                                  builder: (context, child) => Visibility(
                                      visible: !_reveal.isDismissed,
                                      child: IgnorePointer(
                                          ignoring: !_expanded,
                                          child: ExcludeSemantics(
                                              excluding: !_expanded,
                                              child: Opacity(
                                                  opacity: _reveal.value,
                                                  child: child)))),
                                  child: CartScreen(
                                      state: widget.state,
                                      cardSurfaces: true,
                                      dark: Theme.of(context).brightness ==
                                          Brightness.dark,
                                      onProceedToCheckout: widget.onCheckout,
                                      onContinueShopping: close))),
                          AnimatedBuilder(
                              animation: _reveal,
                              child: SizedBox(
                                  height: catalogHeight,
                                  child: RepaintBoundary(child: widget.child)),
                              builder: (context, child) {
                                final progress = Curves.easeInOutCubic
                                    .transform(_reveal.value);
                                return Positioned(
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    height: catalogHeight,
                                    child: Transform.translate(
                                        offset: Offset(0,
                                            -(catalogHeight - 54) * progress),
                                        child: IgnorePointer(
                                            ignoring: _expanded,
                                            child: ExcludeSemantics(
                                                excluding: _expanded,
                                                child: ClipRRect(
                                                    borderRadius:
                                                        const BorderRadius
                                                            .vertical(
                                                            bottom:
                                                                Radius
                                                                    .circular(
                                                                        32)),
                                                    child: ColoredBox(
                                                        color: widget
                                                                .catalogColor ??
                                                            Colors.transparent,
                                                        child: child))))));
                              }),
                          if (_expanded)
                            Positioned(
                                top: 0,
                                left: 0,
                                right: 0,
                                height: 56,
                                child: Semantics(
                                    button: true,
                                    label: 'Back to collection',
                                    child: GestureDetector(
                                        onTap: close,
                                        onVerticalDragEnd: (details) {
                                          if ((details.primaryVelocity ?? 0) >
                                              100) {
                                            close();
                                          }
                                        },
                                        behavior: HitTestBehavior.opaque,
                                        child: Center(
                                            child: Container(
                                                width: 44,
                                                height: 5,
                                                decoration: BoxDecoration(
                                                    color: Theme.of(context)
                                                                .brightness ==
                                                            Brightness.dark
                                                        ? Colors.white54
                                                        : Colors.black38,
                                                    borderRadius:
                                                        BorderRadius.circular(
                                                            8))))))),
                          if (showDock)
                            Positioned(
                                left: 0,
                                right: 0,
                                bottom: 0,
                                height: dockHeight,
                                child: AnimatedBuilder(
                                    animation: _reveal,
                                    child: IgnorePointer(
                                        ignoring: _expanded,
                                        child: ExcludeSemantics(
                                            excluding: _expanded,
                                            child: RepaintBoundary(
                                                child: CartDock(
                                                    state: widget.state,
                                                    landingKey: _landing,
                                                    onOpen: open)))),
                                    builder: (context, child) =>
                                        Transform.translate(
                                            offset: Offset(
                                                0,
                                                dockHeight *
                                                    Curves.easeInOutCubic
                                                        .transform(
                                                            _reveal.value)),
                                            child: child))),
                          AnimatedBuilder(
                              animation: _flight,
                              child: _flyingProduct == null
                                  ? null
                                  : RepaintBoundary(
                                      child: StitchImage(
                                          imageUrl: _flyingProduct!.imageUrl,
                                          fit: BoxFit.contain,
                                          width: 64,
                                          height: 64)),
                              builder: (context, image) {
                                if (_flyingProduct == null ||
                                    _flight.value == 1) {
                                  return const SizedBox.shrink();
                                }
                                final t = Curves.easeInOutCubic
                                    .transform(_flight.value);
                                final point = Offset.lerp(_from, _to, t)! +
                                    Offset(0, -90 * math.sin(math.pi * t));
                                return Positioned(
                                    left: point.dx - 32,
                                    top: point.dy - 32,
                                    width: 64,
                                    height: 64,
                                    child: IgnorePointer(
                                        child: ExcludeSemantics(
                                            child: Transform.scale(
                                                scale: 1 - .375 * t,
                                                child: Material(
                                                    elevation: 8 * (1 - t),
                                                    color: Colors.white,
                                                    shape: const CircleBorder(),
                                                    clipBehavior:
                                                        Clip.antiAlias,
                                                    child: image)))));
                              }),
                        ]));
              })));
}

class CartDock extends StatelessWidget {
  final AppState state;
  final VoidCallback onOpen;
  final GlobalKey? landingKey;
  const CartDock(
      {super.key, required this.state, required this.onOpen, this.landingKey});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final foreground = Theme.of(context).colorScheme.onSurface;
    final duration = MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 360);
    return Material(
        color: Theme.of(context).scaffoldBackgroundColor,
        child: SafeArea(
            top: false,
            child: Semantics(
                button: true,
                label:
                    'Open cart, ${state.cartCount} items, subtotal ₹${state.cartSubtotal}',
                excludeSemantics: true,
                child: GestureDetector(
                    onVerticalDragEnd: (details) {
                      if ((details.primaryVelocity ?? 0) < -100) onOpen();
                    },
                    child: InkWell(
                        onTap: onOpen,
                        child: Padding(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 22, vertical: 16),
                            child: Row(children: [
                              Text('Cart',
                                  style: TextStyle(
                                      color: foreground,
                                      fontSize: 17,
                                      fontWeight: FontWeight.w700)),
                              const SizedBox(width: 18),
                              Expanded(
                                  child: SizedBox(
                                      height: 42,
                                      child: ClipRect(
                                          child:
                                              Row(key: landingKey, children: [
                                        for (final item in state.cart.take(3))
                                          Flexible(
                                              child: TweenAnimationBuilder<double>(
                                                  key:
                                                      ValueKey(item.product.id),
                                                  tween:
                                                      Tween(begin: 0, end: 1),
                                                  duration: duration,
                                                  curve: Curves.easeOutBack,
                                                  builder: (_, value, child) =>
                                                      Transform.scale(
                                                          scale: value,
                                                          child: child),
                                                  child: Padding(
                                                      padding:
                                                          const EdgeInsets.only(
                                                              right: 6),
                                                      child: ClipOval(
                                                          child: StitchImage(
                                                              imageUrl: item
                                                                  .product
                                                                  .imageUrl,
                                                              width: 36,
                                                              height: 36,
                                                              fit: BoxFit
                                                                  .contain))))),
                                        if (state.cart.isEmpty)
                                          Flexible(
                                              child: Text('Your bag is empty',
                                                  maxLines: 1,
                                                  overflow:
                                                      TextOverflow.ellipsis,
                                                  style: TextStyle(
                                                      color: dark
                                                          ? Colors.white60
                                                          : Colors.black54,
                                                      fontSize: 11))),
                                      ])))),
                              const SizedBox(width: 8),
                              AnimatedSwitcher(
                                  duration: duration,
                                  transitionBuilder: (child, animation) =>
                                      ScaleTransition(
                                          scale: animation, child: child),
                                  child: Container(
                                      key: ValueKey(state.cartCount),
                                      constraints: const BoxConstraints(
                                          minWidth: 44, minHeight: 44),
                                      alignment: Alignment.center,
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 10),
                                      decoration: const BoxDecoration(
                                          color: cartYellow,
                                          shape: BoxShape.circle),
                                      child: Text('${state.cartCount}',
                                          style: const TextStyle(
                                              color: cartInk,
                                              fontSize: 16,
                                              fontWeight: FontWeight.w700)))),
                            ])))))));
  }
}
