import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/app_state.dart';
import '../../core/widgets/stitch_image.dart';
import '../../core/widgets/glass_panel.dart';
import '../../core/widgets/commerce_ui.dart';

class CartScreen extends StatefulWidget {
  final AppState state;
  final bool dark;
  final bool showHeading, cardSurfaces;
  final VoidCallback onProceedToCheckout, onContinueShopping;
  const CartScreen(
      {super.key,
      required this.state,
      this.dark = false,
      this.showHeading = true,
      this.cardSurfaces = false,
      required this.onProceedToCheckout,
      required this.onContinueShopping});
  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  final _coupon = TextEditingController();
  bool _applying = false;
  String? _couponMessage;
  @override
  void dispose() {
    _coupon.dispose();
    super.dispose();
  }

  Color get _muted => AppColors.of(context).secondary;

  Widget _panel(
          {required Widget child, double radius = 16, bool blur = false}) =>
      GlassPanel(radius: radius, blur: blur, child: child);

  @override
  Widget build(BuildContext context) => _content();

  Widget _content() => AnimatedBuilder(
      animation: widget.state,
      builder: (context, _) {
        final s = widget.state;
        if (s.cart.isEmpty) {
          return Center(
              child: SingleChildScrollView(
                  child: Padding(
                      padding: const EdgeInsets.all(28),
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        CircleAvatar(
                            radius: 40,
                            backgroundColor:
                                AppColors.of(context).secondaryContainer,
                            child: Icon(Icons.shopping_bag_outlined,
                                size: 32,
                                color: AppColors.of(context).onSurface)),
                        const SizedBox(height: 24),
                        Text('Good things belong here.',
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.headlineSmall),
                        const SizedBox(height: 12),
                        const Text(
                            'Find your everyday hair, beard and skincare essentials.',
                            textAlign: TextAlign.center),
                        const SizedBox(height: 24),
                        FilledButton(
                            onPressed: widget.onContinueShopping,
                            child: const Text('Explore the shop')),
                      ]))));
        }
        final items = <Widget>[
          if (widget.showHeading) ...[
            const CommerceIntro(
                title: 'Your bag',
                eyebrow: 'Daily essentials',
                icon: Icons.shopping_bag_outlined),
            const SizedBox(height: 8),
          ],
          Text(
              '${s.cartCount} ${s.cartCount == 1 ? 'item' : 'items'} · Your daily essentials',
              style: TextStyle(color: _muted)),
          const SizedBox(height: 24),
          if (s.pendingPayment != null)
            const Padding(
                padding: EdgeInsets.only(bottom: 16),
                child: Text(
                    'A payment is in progress. Check its status before changing your bag.')),
          ...s.cart.map((item) => Padding(
              padding: const EdgeInsets.only(bottom: 18),
              child: _panel(
                  radius: 20,
                  child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            StitchImage(
                                imageUrl: item.product.imageUrl,
                                width: 82,
                                height: 108,
                                borderRadius: BorderRadius.circular(14)),
                            const SizedBox(width: 14),
                            Expanded(
                                child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                  Text(item.product.name,
                                      style: const TextStyle(
                                          fontSize: 14,
                                          fontWeight: FontWeight.w600)),
                                  const SizedBox(height: 4),
                                  Text(
                                      [
                                        item.product.category,
                                        if (item.product.volume.isNotEmpty)
                                          item.product.volume
                                      ].join(' · '),
                                      style: TextStyle(
                                          fontSize: 11, color: _muted)),
                                  const SizedBox(height: 8),
                                  Text('₹${item.product.price} each',
                                      style: const TextStyle(
                                          fontSize: 13,
                                          fontWeight: FontWeight.w600)),
                                  const SizedBox(height: 6),
                                  Wrap(
                                      crossAxisAlignment:
                                          WrapCrossAlignment.center,
                                      spacing: 8,
                                      children: [
                                        DecoratedBox(
                                            decoration: BoxDecoration(
                                                color: Theme.of(context)
                                                    .colorScheme
                                                    .surfaceContainerHighest,
                                                borderRadius:
                                                    BorderRadius.circular(24)),
                                            child: Row(
                                                mainAxisSize: MainAxisSize.min,
                                                children: [
                                                  IconButton(
                                                      key: ValueKey(
                                                          'minus-${item.product.id}'),
                                                      tooltip:
                                                          'Decrease quantity',
                                                      onPressed: s.pendingPayment !=
                                                              null
                                                          ? null
                                                          : () =>
                                                              s.updateCartQty(
                                                                  item.product
                                                                      .id,
                                                                  item.quantity -
                                                                      1),
                                                      icon: const Icon(
                                                          Icons.remove,
                                                          size: 16)),
                                                  AnimatedSwitcher(
                                                      duration: MediaQuery
                                                              .disableAnimationsOf(
                                                                  context)
                                                          ? Duration.zero
                                                          : const Duration(
                                                              milliseconds:
                                                                  180),
                                                      child: Text(
                                                          '${item.quantity}',
                                                          key: ValueKey(
                                                              'qty-${item.product.id}-${item.quantity}'),
                                                          style: const TextStyle(
                                                              fontSize: 12,
                                                              fontWeight:
                                                                  FontWeight
                                                                      .w600))),
                                                  IconButton(
                                                      key: ValueKey(
                                                          'plus-${item.product.id}'),
                                                      tooltip:
                                                          'Increase quantity',
                                                      onPressed: s.pendingPayment !=
                                                                  null ||
                                                              item.quantity >=
                                                                  100
                                                          ? null
                                                          : () =>
                                                              s.updateCartQty(
                                                                  item.product
                                                                      .id,
                                                                  item.quantity +
                                                                      1),
                                                      icon: const Icon(
                                                          Icons.add,
                                                          size: 16)),
                                                ])),
                                        IconButton(
                                            tooltip:
                                                'Remove ${item.product.name}',
                                            onPressed: s.pendingPayment != null
                                                ? null
                                                : () {
                                                    final quantity =
                                                        item.quantity;
                                                    s.updateCartQty(
                                                        item.product.id, 0);
                                                    ScaffoldMessenger.of(
                                                            context)
                                                        .showSnackBar(SnackBar(
                                                            content: Text(
                                                                '${item.product.name} removed'),
                                                            action: SnackBarAction(
                                                                label: 'Undo',
                                                                onPressed: () =>
                                                                    s.addToCart(
                                                                        item
                                                                            .product,
                                                                        qty:
                                                                            quantity))));
                                                  },
                                            icon: const Icon(Icons.close,
                                                size: 17)),
                                      ]),
                                ])),
                          ]))))),
          Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                  onPressed: widget.onContinueShopping,
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Continue shopping'))),
          const SizedBox(height: 8),
          if (s.isSyncingCart) const LinearProgressIndicator(minHeight: 2),
          if (s.syncError != null) ...[
            Text(s.syncError!,
                style: TextStyle(color: AppColors.of(context).error)),
            TextButton(
                onPressed: s.syncCart, child: const Text('Retry cart sync'))
          ],
          if (s.isLoggedIn && s.pendingPayment == null) ...[
            TextField(
                controller: _coupon,
                textCapitalization: TextCapitalization.characters,
                decoration: InputDecoration(
                    labelText: 'Promo code',
                    suffixIcon: TextButton(
                        onPressed: _applying
                            ? null
                            : () async {
                                setState(() {
                                  _applying = true;
                                  _couponMessage = null;
                                });
                                try {
                                  final applied =
                                      await s.applyPromo(_coupon.text);
                                  if (mounted) {
                                    setState(() => _couponMessage = applied
                                        ? 'Promo applied. Your checkout will show the final total.'
                                        : 'This code could not be applied.');
                                  }
                                } catch (e) {
                                  if (mounted) {
                                    setState(
                                        () => _couponMessage = e.toString());
                                  }
                                } finally {
                                  if (mounted) {
                                    setState(() => _applying = false);
                                  }
                                }
                              },
                        child: Text(_applying ? 'Checking…' : 'Apply')))),
            if (_couponMessage != null)
              Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(_couponMessage!)),
            if (s.appliedPromo != null)
              TextButton(
                  onPressed: s.removePromo,
                  child: Text('Remove ${s.appliedPromo}')),
          ],
          const SizedBox(height: 20),
          Text(
              'Delivery, discounts and any applicable taxes are calculated at checkout.',
              style: TextStyle(fontSize: 13, color: _muted)),
        ];
        final summary = SafeArea(
            top: false,
            child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: CommerceActionArea(
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                  SizedBox(
                      width: double.infinity,
                      child: Wrap(
                          alignment: WrapAlignment.spaceBetween,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          spacing: 12,
                          children: [
                            const Text('Items subtotal'),
                            Text('₹${s.cartSubtotal}',
                                key: const ValueKey('cart-subtotal'),
                                style: const TextStyle(
                                    fontSize: 22, fontWeight: FontWeight.w800))
                          ])),
                  const SizedBox(height: 14),
                  SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                          onPressed: widget.onProceedToCheckout,
                          child: Text(s.pendingPayment != null
                              ? 'Check payment status'
                              : s.isLoggedIn
                                  ? 'Continue to checkout'
                                  : 'Sign in to checkout'))),
                ]))));
        return LayoutBuilder(builder: (context, constraints) {
          if (constraints.maxHeight < 430) {
            return ListView(children: [
              Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: items)),
              summary
            ]);
          }
          return Column(children: [
            Expanded(
                child: ListView(
                    padding: const EdgeInsets.all(20), children: items)),
            summary
          ]);
        });
      });
}
