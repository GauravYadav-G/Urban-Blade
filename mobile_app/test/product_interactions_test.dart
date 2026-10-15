import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/models/product_model.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/features/shop/product_detail_screen.dart';
import 'package:urban_blade_mobile/features/cart/cart_screen.dart';

void main() {
  const product = ProductModel(
      id: 'care',
      name: 'Daily care',
      price: 300,
      imageUrl: '',
      category: 'hair',
      description: 'Daily conditioning.');
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('missing catalog reviews are not replaced with fabricated ratings', () {
    final product = ProductModel.fromJson(
        {'id': 'care', 'name': 'Daily care', 'price': 300});
    expect(product.reviewCount, 0);
    expect(product.rating, 0);
    expect(product.volume, isEmpty);
  });

  testWidgets('quantity, saved items, and buy now use the real cart state',
      (tester) async {
    final state = AppState(autoLoad: false);
    var checkouts = 0;
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: ProductDetailScreen(
            product: product, state: state, onBuyNow: () => checkouts++)));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.byTooltip('Increase quantity'), 160,
        scrollable: find.byType(Scrollable).first);
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Increase quantity'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Add to bag'));
    await tester.pumpAndSettle();
    expect(state.cartCount, 2);
    expect(state.cartSubtotal, 600);
    await tester.tap(find.byTooltip('Save product'));
    await tester.pumpAndSettle();
    expect(state.wishlist, contains('care'));
    await tester.tap(find.text('Buy now · ₹600'));
    await tester.pumpAndSettle();
    expect(checkouts, 1);
    expect(state.cartCount, 4);
    expect(tester.takeException(), isNull);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });

  testWidgets('removal undo restores the original quantity with reduced motion',
      (tester) async {
    final state = AppState(autoLoad: false)..addToCart(product, qty: 3);
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(disableAnimations: true),
            child: child!),
        home: Scaffold(
            body: CartScreen(
                state: state,
                onProceedToCheckout: () {},
                onContinueShopping: () {}))));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Remove Daily care'));
    await tester.pumpAndSettle();
    expect(state.cart, isEmpty);
    await tester.tap(find.text('Undo'));
    await tester.pumpAndSettle();
    expect(state.cartCount, 3);
    expect(state.cartSubtotal, 900);
    expect(tester.takeException(), isNull);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });
}
