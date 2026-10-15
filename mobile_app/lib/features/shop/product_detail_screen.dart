import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/services/app_state.dart';
import '../../core/models/product_model.dart';
import '../../core/widgets/entrance.dart';
import '../../core/widgets/glass_panel.dart';
import '../../core/widgets/premium_scaffold.dart';
import '../../core/widgets/stitch_image.dart';

class ProductDetailScreen extends StatefulWidget {
  final ProductModel product;
  final String? heroTag;
  final AppState state;
  final VoidCallback onBuyNow;
  final VoidCallback? onAdded;
  final VoidCallback? onOpenCart;
  const ProductDetailScreen(
      {super.key,
      required this.product,
      this.heroTag,
      required this.state,
      required this.onBuyNow,
      this.onAdded,
      this.onOpenCart});
  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  final _quantity = ValueNotifier<int>(1);
  late final ValueNotifier<bool> _availability;

  bool get _canPurchase =>
      widget.product.inStock && widget.state.pendingPayment == null;

  void _updateAvailability() => _availability.value = _canPurchase;

  @override
  void initState() {
    super.initState();
    _availability = ValueNotifier(_canPurchase);
    widget.state.addListener(_updateAvailability);
  }

  @override
  void didUpdateWidget(covariant ProductDetailScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.state != widget.state) {
      oldWidget.state.removeListener(_updateAvailability);
      widget.state.addListener(_updateAvailability);
    }
    _updateAvailability();
  }

  @override
  void dispose() {
    widget.state.removeListener(_updateAvailability);
    _availability.dispose();
    _quantity.dispose();
    super.dispose();
  }

  Duration get _motion => MediaQuery.disableAnimationsOf(context)
      ? Duration.zero
      : const Duration(milliseconds: 220);

  void _add({bool checkout = false}) {
    if (!widget.product.inStock || widget.state.pendingPayment != null) return;
    widget.state.addToCart(widget.product, qty: _quantity.value);
    HapticFeedback.lightImpact();
    if (checkout) {
      widget.onBuyNow();
    } else if (widget.onAdded != null) {
      widget.onAdded!();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(
              '${_quantity.value} ${_quantity.value == 1 ? 'item' : 'items'} added to your bag')));
    }
  }

  Widget _quantitySelector(bool available) => ValueListenableBuilder<int>(
      valueListenable: _quantity,
      builder: (context, quantity, _) => GlassPanel(
          radius: 28,
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            IconButton(
                tooltip: 'Decrease quantity',
                onPressed: !available || quantity <= 1
                    ? null
                    : () => _quantity.value--,
                icon: const Icon(Icons.remove_rounded, size: 18)),
            ConstrainedBox(
                constraints: const BoxConstraints(minWidth: 22),
                child: AnimatedSwitcher(
                    duration: _motion,
                    child: Text('$quantity',
                        key: ValueKey(quantity),
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                            fontSize: 15, fontWeight: FontWeight.w700)))),
            IconButton(
                tooltip: 'Increase quantity',
                onPressed: !available || quantity >= 100
                    ? null
                    : () => _quantity.value++,
                icon: const Icon(Icons.add_rounded, size: 18)),
          ])));

  Widget _details(bool available) {
    final product = widget.product;
    final colors = Theme.of(context).colorScheme;
    final compareAt = product.compareAtPrice;
    return Entrance(
        child: GlassPanel(
            key: const ValueKey('product-details-panel'),
            overImage: true,
            radius: 32,
            padding: const EdgeInsets.fromLTRB(24, 26, 24, 24),
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(product.category.toUpperCase(),
                      style: TextStyle(
                          fontSize: 10,
                          letterSpacing: 1.8,
                          fontWeight: FontWeight.w700,
                          color: colors.onSurfaceVariant)),
                  const SizedBox(height: 10),
                  Text(product.name,
                      style: Theme.of(context)
                          .textTheme
                          .headlineMedium
                          ?.copyWith(
                              fontSize: 30, height: 1.15, letterSpacing: -.8)),
                  const SizedBox(height: 16),
                  Wrap(
                      spacing: 12,
                      runSpacing: 10,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text('₹${product.price}',
                            style: TextStyle(
                                fontSize: 26,
                                fontWeight: FontWeight.w800,
                                color: colors.onSurface)),
                        if (compareAt != null && compareAt > product.price)
                          Text('₹$compareAt',
                              style: TextStyle(
                                  fontSize: 14,
                                  decoration: TextDecoration.lineThrough,
                                  color: colors.onSurfaceVariant)),
                        if (product.volume.isNotEmpty)
                          GlassPanel(
                              radius: 14,
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 12, vertical: 8),
                              child: Text(product.volume,
                                  style: const TextStyle(fontSize: 12))),
                      ]),
                  if (product.reviewCount > 0 && product.rating > 0) ...[
                    const SizedBox(height: 12),
                    Row(children: [
                      Icon(Icons.star_rounded,
                          size: 18, color: colors.secondary),
                      const SizedBox(width: 6),
                      Expanded(
                          child: Text(
                              '${product.rating} · ${product.reviewCount} reviews',
                              style: TextStyle(
                                  fontSize: 12,
                                  color: colors.onSurfaceVariant))),
                    ]),
                  ],
                  const SizedBox(height: 18),
                  Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Icon(
                        product.inStock
                            ? Icons.check_circle_outline
                            : Icons.info_outline,
                        size: 19,
                        color: colors.primary),
                    const SizedBox(width: 9),
                    Expanded(
                        child: Text(
                            product.inStock
                                ? 'In stock · Ready for your routine'
                                : 'Currently sold out',
                            style: TextStyle(
                                fontSize: 12, color: colors.onSurfaceVariant))),
                  ]),
                  const Padding(
                      padding: EdgeInsets.symmetric(vertical: 20),
                      child: Divider(height: 1)),
                  Wrap(
                      alignment: WrapAlignment.spaceBetween,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 14,
                      runSpacing: 10,
                      children: [
                        const Text('Quantity',
                            style: TextStyle(
                                fontSize: 14, fontWeight: FontWeight.w600)),
                        _quantitySelector(available),
                      ]),
                  if (MediaQuery.sizeOf(context).height < 450) ...[
                    const SizedBox(height: 8),
                    _buyNow(available),
                  ],
                  if (product.highlights.isNotEmpty) ...[
                    const SizedBox(height: 22),
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      for (final text in product.highlights)
                        GlassPanel(
                            radius: 16,
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 10),
                            child: Text(text,
                                style: TextStyle(
                                    fontSize: 12,
                                    color: colors.onSurfaceVariant))),
                    ]),
                  ],
                  const SizedBox(height: 22),
                  const Divider(height: 1),
                  _ProductDescription(description: product.description),
                  if (widget.state.pendingPayment != null)
                    Padding(
                        padding: const EdgeInsets.only(top: 18),
                        child: Text(
                            'Finish your pending checkout before adding more items.',
                            style: TextStyle(
                                fontSize: 12, color: colors.onSurfaceVariant))),
                ])));
  }

  Widget _purchaseDock(bool available) {
    final product = widget.product;
    final colors = Theme.of(context).colorScheme;
    final compact = MediaQuery.sizeOf(context).height < 450;
    return ValueListenableBuilder<int>(
        valueListenable: _quantity,
        builder: (context, quantity, _) => SafeArea(
            top: false,
            child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
                child: GlassPanel(
                    key: const ValueKey('product-purchase-dock'),
                    radius: 28,
                    blur: true,
                    padding: const EdgeInsets.fromLTRB(18, 12, 18, 4),
                    child: LayoutBuilder(builder: (context, constraints) {
                      final stack = constraints.maxWidth < 340 &&
                          MediaQuery.textScalerOf(context).scale(14) > 20;
                      final total = Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text('Total',
                                style: TextStyle(
                                    fontSize: 11,
                                    height: 1.2,
                                    color: colors.onSurfaceVariant)),
                            const SizedBox(height: 3),
                            AnimatedSwitcher(
                                duration: _motion,
                                child: Text('₹${product.price * quantity}',
                                    key: ValueKey(
                                        'detail-total-${product.price * quantity}'),
                                    style: TextStyle(
                                        fontSize: compact ? 18 : 22,
                                        height: 1.15,
                                        fontWeight: FontWeight.w800))),
                          ]);
                      final add = FilledButton(
                          onPressed: available ? _add : null,
                          style: FilledButton.styleFrom(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 20, vertical: 14)),
                          child: Text(
                              product.inStock ? 'Add to bag' : 'Sold out',
                              textAlign: TextAlign.center));
                      return Column(mainAxisSize: MainAxisSize.min, children: [
                        if (stack) ...[
                          Align(alignment: Alignment.centerLeft, child: total),
                          const SizedBox(height: 10),
                          SizedBox(width: double.infinity, child: add),
                        ] else
                          Row(
                              crossAxisAlignment: CrossAxisAlignment.center,
                              children: [
                                Expanded(flex: compact ? 2 : 1, child: total),
                                const SizedBox(width: 12),
                                Expanded(flex: compact ? 3 : 2, child: add),
                              ]),
                        if (!compact)
                          SizedBox(
                              width: double.infinity,
                              child: _buyNow(available)),
                      ]);
                    })))));
  }

  Widget _buyNow(bool available) => ValueListenableBuilder<int>(
      valueListenable: _quantity,
      builder: (context, quantity, _) => TextButton(
          onPressed: available ? () => _add(checkout: true) : null,
          child: Text('Buy now · ₹${widget.product.price * quantity}',
              style: const TextStyle(fontSize: 12))));

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final landscape = size.width > size.height;
    final photoHeight = landscape
        ? (size.height * .75).clamp(210.0, 320.0)
        : (size.height * .49).clamp(310.0, 470.0);
    final product = widget.product;
    final photo = RepaintBoundary(
        child: SizedBox(
            key: const ValueKey('product-photo'),
            height: photoHeight,
            width: double.infinity,
            child: Stack(fit: StackFit.expand, children: [
              Semantics(
                  image: true,
                  label: product.name,
                  child: widget.heroTag == null
                      ? StitchImage(imageUrl: product.imageUrl)
                      : Hero(
                          tag: widget.heroTag!,
                          child: StitchImage(imageUrl: product.imageUrl))),
              if (product.badge?.isNotEmpty == true)
                Positioned(
                    left: 20,
                    right: 20,
                    bottom: 56,
                    child: Align(
                        alignment: Alignment.centerLeft,
                        child: GlassPanel(
                            radius: 24,
                            padding: const EdgeInsets.symmetric(
                                horizontal: 14, vertical: 9),
                            child: Text(product.badge!,
                                style: const TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600))))),
            ])));
    return AnimatedBuilder(
        animation: _availability,
        child: photo,
        builder: (context, photo) {
          final available =
              product.inStock && widget.state.pendingPayment == null;
          return AnnotatedRegion<SystemUiOverlayStyle>(
              value: SystemUiOverlayStyle(
                  statusBarColor: Colors.transparent,
                  statusBarIconBrightness: Brightness.light,
                  statusBarBrightness: Brightness.dark,
                  systemNavigationBarColor:
                      Theme.of(context).colorScheme.surface,
                  systemNavigationBarIconBrightness:
                      Theme.of(context).brightness == Brightness.dark
                          ? Brightness.light
                          : Brightness.dark),
              child: PremiumScaffold(
                  body: Stack(children: [
                    CustomScrollView(
                        key: const ValueKey('product-detail-scroll'),
                        slivers: [
                          SliverToBoxAdapter(
                              child: Stack(children: [
                            if (photo != null) photo,
                            Padding(
                                padding: EdgeInsets.only(top: photoHeight - 34),
                                child: _details(available)),
                          ])),
                        ]),
                    if (MediaQuery.paddingOf(context).top > 0)
                      Positioned(
                          top: 0,
                          left: 0,
                          right: 0,
                          height: MediaQuery.paddingOf(context).top + 16,
                          child: const IgnorePointer(
                              child: DecoratedBox(
                                  key: ValueKey('product-status-scrim'),
                                  decoration: BoxDecoration(
                                      gradient: LinearGradient(
                                          begin: Alignment.topCenter,
                                          end: Alignment.bottomCenter,
                                          stops: [
                                        0,
                                        .7,
                                        1
                                      ],
                                          colors: [
                                        Color(0xBD000000),
                                        Color(0xBD000000),
                                        Colors.transparent,
                                      ]))))),
                    Positioned(
                        top: 0,
                        left: 16,
                        right: 16,
                        child: SafeArea(
                            bottom: false,
                            child: Padding(
                                padding: const EdgeInsets.only(top: 10),
                                child: AnimatedBuilder(
                                    animation: widget.state,
                                    builder: (context, _) => Stack(
                                            alignment: Alignment.center,
                                            children: [
                                              Padding(
                                                  padding: EdgeInsets.symmetric(
                                                      horizontal: widget.onOpenCart == null
                                                          ? 58
                                                          : 114),
                                                  child: LayoutBuilder(
                                                      builder: (context, constraints) => constraints.maxWidth < 130 ||
                                                              MediaQuery.textScalerOf(context).scale(11) >
                                                                  16
                                                          ? const SizedBox
                                                              .shrink()
                                                          : GlassPanel(
                                                              radius: 24,
                                                              padding: const EdgeInsets.symmetric(
                                                                  horizontal:
                                                                      12,
                                                                  vertical: 9),
                                                              child: const Text(
                                                                  'Product details',
                                                                  textAlign: TextAlign.center,
                                                                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700))))),
                                              Row(children: [
                                                _DetailControl(
                                                    tooltip: 'Back',
                                                    icon: Icons
                                                        .arrow_back_rounded,
                                                    onPressed: () =>
                                                        Navigator.maybePop(
                                                            context)),
                                                const Spacer(),
                                                if (widget.onOpenCart !=
                                                    null) ...[
                                                  _DetailControl(
                                                      tooltip: 'Shopping cart',
                                                      icon: Icons
                                                          .shopping_bag_outlined,
                                                      onPressed:
                                                          widget.onOpenCart,
                                                      count: widget
                                                          .state.cartCount),
                                                  const SizedBox(width: 8),
                                                ],
                                                _DetailControl(
                                                    tooltip: 'Save product',
                                                    icon: widget.state.wishlist
                                                            .contains(
                                                                product.id)
                                                        ? Icons.favorite_rounded
                                                        : Icons
                                                            .favorite_border_rounded,
                                                    selected: widget
                                                        .state.wishlist
                                                        .contains(product.id),
                                                    onPressed: () => widget
                                                        .state
                                                        .toggleWishlist(
                                                            product.id)),
                                              ]),
                                            ]))))),
                  ]),
                  bottomNavigationBar: _purchaseDock(available)));
        });
  }
}

class _DetailControl extends StatelessWidget {
  final String tooltip;
  final IconData icon;
  final VoidCallback? onPressed;
  final bool selected;
  final int? count;
  const _DetailControl(
      {required this.tooltip,
      required this.icon,
      required this.onPressed,
      this.selected = false,
      this.count});
  @override
  Widget build(BuildContext context) => PressScale(
      child: GlassPanel(
          radius: 40,
          blur: true,
          child: SizedBox(
              width: 48,
              height: 48,
              child: IconButton(
                  padding: EdgeInsets.zero,
                  alignment: Alignment.center,
                  tooltip: tooltip,
                  onPressed: onPressed,
                  color: selected
                      ? Theme.of(context).colorScheme.primary
                      : Theme.of(context).colorScheme.onSurface,
                  icon: count == null
                      ? Icon(icon, size: 21)
                      : Badge(
                          isLabelVisible: count! > 0,
                          label: Text('$count'),
                          child: Icon(icon, size: 21))))));
}

class _ProductDescription extends StatefulWidget {
  final String description;
  const _ProductDescription({required this.description});

  @override
  State<_ProductDescription> createState() => _ProductDescriptionState();
}

class _ProductDescriptionState extends State<_ProductDescription> {
  bool _expanded = true;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => setState(() => _expanded = !_expanded),
          child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 18),
              child: Row(children: [
                const Expanded(
                    child: Text('Description',
                        style: TextStyle(fontWeight: FontWeight.w700))),
                Icon(_expanded ? Icons.remove_rounded : Icons.add_rounded,
                    size: 19, color: colors.onSurfaceVariant),
              ]))),
      AnimatedSize(
          duration: MediaQuery.disableAnimationsOf(context)
              ? Duration.zero
              : const Duration(milliseconds: 220),
          curve: Curves.easeOutCubic,
          alignment: Alignment.topCenter,
          child: _expanded
              ? Text(
                  widget.description.isEmpty
                      ? 'Additional product details are not available yet.'
                      : widget.description,
                  style: TextStyle(
                      fontSize: 13,
                      height: 1.7,
                      color: colors.onSurfaceVariant))
              : const SizedBox(width: double.infinity)),
    ]);
  }
}
