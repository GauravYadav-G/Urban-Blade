import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/features/cart/cart_flow.dart';
import 'package:urban_blade_mobile/features/main_shell.dart';
import 'package:urban_blade_mobile/features/shop/product_detail_screen.dart';
import 'visual_preview_test.dart' show PreviewApi;

void main() {
  for (final reduced in [false, true]) {
    testWidgets(
        'cart reveal, quantities, back and checkout (reduced: $reduced)',
        (tester) async {
      SharedPreferences.setMockInitialValues({});
      tester.view.physicalSize = const Size(320, 720);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final state = AppState(api: PreviewApi(), autoLoad: false);
      await state.loadRemoteData();
      final flow = GlobalKey<CartFlowState>();
      var checkouts = 0;
      await tester.pumpWidget(MaterialApp(
          theme: AppTheme.lightTheme,
          builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                  disableAnimations: reduced,
                  textScaler: const TextScaler.linear(1.6)),
              child: child!),
          home: Scaffold(
              body: CartFlow(
                  key: flow,
                  state: state,
                  onCheckout: () => checkouts++,
                  child: const Center(child: Text('Collection'))))));
      flow.currentState!.add(state.products.first, const Offset(100, 180));
      flow.currentState!.add(state.products.last, const Offset(200, 180));
      flow.currentState!.add(state.products.first, const Offset(100, 180));
      await tester.pumpAndSettle();
      expect(state.cartCount, 3);
      expect(find.text('Your bag'), findsNothing);
      await tester.fling(find.byType(CartDock), const Offset(0, -150), 700);
      await tester.pumpAndSettle();
      expect(find.text('Your bag'), findsOneWidget);
      await tester.ensureVisible(find.byKey(const ValueKey('plus-oil')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('plus-oil')));
      await tester.pumpAndSettle();
      expect(state.cartCount, 4);
      await tester.tap(find.text('Sign in to checkout'));
      expect(checkouts, 1);
      // System back collapses the panel without leaving the collection.
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('Your bag'), findsNothing);
      expect(find.text('Collection').hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
      await state.persistDraft();
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    });
  }

  testWidgets('expanded cart remains scrollable in landscape with large text',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(800, 400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final state = AppState(api: PreviewApi(), autoLoad: false);
    await state.loadRemoteData();
    state.addToCart(state.products.first);
    final flow = GlobalKey<CartFlowState>();
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: const TextScaler.linear(2)),
            child: child!),
        home: Scaffold(
            body: CartFlow(
                key: flow,
                state: state,
                onCheckout: () {},
                child: const Center(child: Text('Collection'))))));
    flow.currentState!.open();
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Sign in to checkout'), 160,
        scrollable: find.byType(Scrollable).last);
    await tester.pumpAndSettle();
    expect(find.text('Sign in to checkout').hitTestable(), findsOneWidget);
    expect(tester.takeException(), isNull);
    state.clearCart();
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Explore the shop'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Explore the shop'));
    await tester.pumpAndSettle();
    expect(find.text('Collection').hitTestable(), findsOneWidget);
    expect(tester.takeException(), isNull);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });

  testWidgets(
      'details return to collection and cart preview matches the reference flow',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    for (final entry in {
      'PlusJakartaSans': 'assets/fonts/PlusJakartaSans.ttf',
      'CormorantGaramond': 'assets/fonts/CormorantGaramond.ttf',
      'MaterialIcons': 'fonts/MaterialIcons-Regular.otf'
    }.entries) {
      await (FontLoader(entry.key)..addFont(rootBundle.load(entry.value)))
          .load();
    }
    final state = AppState(api: PreviewApi(), autoLoad: false);
    await state.loadRemoteData();
    await tester.pumpWidget(RepaintBoundary(
        key: const ValueKey('cart-preview'),
        child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: AppTheme.lightTheme,
            home: MainShell(state: state, initialTab: 3))));
    for (final product in state.products) {
      await tester.runAsync(() => precacheImage(AssetImage(product.imageUrl),
          tester.element(find.byType(MainShell))));
    }
    await tester.pumpAndSettle();
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -330));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Beard Oil'));
    await tester.pumpAndSettle();
    expect(find.byType(ProductDetailScreen), findsOneWidget);
    await tester.tap(find.text('Add to bag'));
    await tester.pumpAndSettle();
    expect(find.byType(ProductDetailScreen), findsNothing);
    expect(state.cartCount, 1);
    await tester.tap(find.byTooltip('Add Daily Care Shampoo to bag'));
    await tester.pump(const Duration(milliseconds: 240));
    expect(tester.takeException(), isNull);
    await tester.pumpAndSettle();
    expect(state.cartCount, 2);
    await expectLater(find.byKey(const ValueKey('cart-preview')),
        matchesGoldenFile('goldens/cart-dock.png'));
    await tester.tap(find.text('Cart'));
    await tester.pump(const Duration(milliseconds: 300));
    expect(tester.takeException(), isNull);
    await tester.pumpAndSettle();
    await expectLater(find.byKey(const ValueKey('cart-preview')),
        matchesGoldenFile('goldens/cart-expanded.png'));
    expect(find.text('₹798'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });
}
