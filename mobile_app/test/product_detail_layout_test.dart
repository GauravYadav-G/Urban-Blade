import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/models/product_model.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/features/shop/product_detail_screen.dart';

const _product = ProductModel(
    id: 'detail-care',
    name: 'Daily Conditioning Shampoo for Hair and Scalp',
    price: 1499,
    compareAtPrice: 1799,
    imageUrl: '',
    category: 'hair',
    volume: '250ml',
    description: 'Daily conditioning for your hair and scalp. Use as directed.',
    highlights: ['Daily care', 'Salon formula']);

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  for (final size in [const Size(320, 568), const Size(568, 320)]) {
    for (final appearance in ['light', 'dark', 'contrast']) {
      testWidgets('detail remains usable at $size with 2x text in $appearance',
          (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final state = AppState(autoLoad: false);
        var carts = 0;
        var checkouts = 0;
        await tester.pumpWidget(MaterialApp(
            theme:
                appearance == 'dark' ? AppTheme.darkTheme : AppTheme.lightTheme,
            builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context).copyWith(
                    textScaler: const TextScaler.linear(2),
                    disableAnimations: true,
                    highContrast: appearance == 'contrast'),
                child: child!),
            home: ProductDetailScreen(
                product: _product,
                state: state,
                onBuyNow: () => checkouts++,
                onOpenCart: () => carts++,
                onAdded: () {})));
        await tester.pumpAndSettle();
        expect(find.text('Add to bag').hitTestable(), findsOneWidget);
        expect(find.byTooltip('Save product').hitTestable(), findsOneWidget);
        expect(find.byTooltip('Shopping cart').hitTestable(), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.drag(find.byKey(const ValueKey('product-detail-scroll')),
            const Offset(0, -100));
        await tester.pumpAndSettle();
        final photo =
            tester.getRect(find.byKey(const ValueKey('product-photo')));
        final panel =
            tester.getRect(find.byKey(const ValueKey('product-details-panel')));
        expect(panel.top, lessThan(photo.bottom));
        expect(find.text('HAIR').hitTestable(), findsOneWidget);
        expect(
            find.descendant(
                of: find.byKey(const ValueKey('product-details-panel')),
                matching: find.byType(BackdropFilter)),
            findsNothing);
        if (appearance == 'contrast') {
          expect(find.byType(BackdropFilter), findsNothing);
        }
        expect(
            find.byWidgetPredicate((widget) =>
                widget is Semantics &&
                widget.properties.image == true &&
                widget.properties.label == _product.name),
            findsOneWidget);
        await tester.scrollUntilVisible(
            find.byTooltip('Increase quantity'), 180,
            scrollable: find.byType(Scrollable).first);
        await Scrollable.ensureVisible(
            tester.element(find.byTooltip('Increase quantity')),
            alignment: .65);
        await tester.pumpAndSettle();
        expect(
            find.byTooltip('Increase quantity').hitTestable(), findsOneWidget);
        await tester.tap(find.byTooltip('Increase quantity'));
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('detail-total-2998')), findsOneWidget);
        await tester.tap(find.text('Add to bag'));
        await tester.pumpAndSettle();
        expect(state.cartCount, 2);
        expect(state.cartSubtotal, 2998);
        await tester.tap(find.byTooltip('Save product'));
        await tester.pumpAndSettle();
        expect(state.wishlist, contains('detail-care'));
        await tester.tap(find.byTooltip('Shopping cart'));
        expect(carts, 1);
        if (size.height < 450) {
          await Scrollable.ensureVisible(
              tester.element(find.text('Buy now · ₹2998')),
              alignment: .65);
          await tester.pumpAndSettle();
        }
        await tester.tap(find.text('Buy now · ₹2998'));
        await tester.pumpAndSettle();
        expect(checkouts, 1);
        expect(state.cartCount, 4);
        expect(tester.takeException(), isNull);
        await state.persistDraft();
        await tester.pumpWidget(const SizedBox());
        state.dispose();
      });
    }
  }

  for (final blocked in ['sold out', 'payment pending']) {
    testWidgets('detail prevents additions when $blocked', (tester) async {
      final state = AppState(autoLoad: false);
      if (blocked == 'payment pending') {
        state.pendingPayment = {'orderId': 'saved-order'};
      }
      final product = ProductModel(
          id: 'blocked-care',
          name: 'Daily care',
          price: 300,
          imageUrl: '',
          category: 'hair',
          description: '',
          inStock: blocked != 'sold out');
      var additions = 0;
      var checkouts = 0;
      await tester.pumpWidget(MaterialApp(
          theme: AppTheme.lightTheme,
          home: ProductDetailScreen(
              product: product,
              state: state,
              onBuyNow: () => checkouts++,
              onAdded: () => additions++)));
      await tester.pumpAndSettle();
      final button = tester.widget<FilledButton>(find.byType(FilledButton));
      expect(button.onPressed, isNull);
      await tester.scrollUntilVisible(find.byTooltip('Increase quantity'), 150,
          scrollable: find.byType(Scrollable).first);
      await tester.pumpAndSettle();
      expect(
          tester
              .widget<IconButton>(find.ancestor(
                  of: find.byTooltip('Increase quantity'),
                  matching: find.byType(IconButton)))
              .onPressed,
          isNull);
      expect(state.cartCount, 0);
      expect(additions, 0);
      expect(checkouts, 0);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    });
  }

  testWidgets('header icons align and product has no zoom control',
      (tester) async {
    tester.view.physicalSize = const Size(430, 932);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final state = AppState(autoLoad: false)..addToCart(_product);
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: ProductDetailScreen(
            product: _product,
            state: state,
            onBuyNow: () {},
            onOpenCart: () {})));
    await tester.pumpAndSettle();
    expect(find.byTooltip('Enlarge product image'), findsNothing);
    expect(find.byType(InteractiveViewer), findsNothing);
    final back = tester.getRect(find.byTooltip('Back'));
    final cart = tester.getRect(find.byTooltip('Shopping cart'));
    final save = tester.getRect(find.byTooltip('Save product'));
    expect(back.size, const Size(48, 48));
    expect(cart.size, back.size);
    expect(save.size, back.size);
    expect(cart.center.dy, back.center.dy);
    expect(save.center.dy, back.center.dy);
    expect(tester.getCenter(find.text('Product details')).dx, 215);
    expect(tester.takeException(), isNull);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });

  testWidgets('quantity and saved changes retain the product panel and photo',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final state = AppState(autoLoad: false);
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: ProductDetailScreen(
            product: _product, state: state, onBuyNow: () {})));
    await tester.pumpAndSettle();
    final panelFinder = find.byKey(const ValueKey('product-details-panel'));
    final photoFinder = find.byKey(const ValueKey('product-photo'));
    final panel = tester.widget(panelFinder);
    final photo = tester.widget(photoFinder);
    await tester.scrollUntilVisible(find.byTooltip('Increase quantity'), 150,
        scrollable: find.byType(Scrollable).first);
    await Scrollable.ensureVisible(
        tester.element(find.byTooltip('Increase quantity')),
        alignment: .65);
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Increase quantity'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('detail-total-2998')), findsOneWidget);
    expect(identical(tester.widget(panelFinder), panel), isTrue);
    await tester.tap(find.byTooltip('Save product'));
    await tester.pumpAndSettle();
    expect(state.wishlist, contains(_product.id));
    expect(identical(tester.widget(panelFinder), panel), isTrue);
    expect(identical(tester.widget(photoFinder), photo), isTrue);
    expect(tester.takeException(), isNull);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });

  testWidgets('immersive detail keeps controls below the status inset',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    tester.view.padding = const FakeViewPadding(top: 34, bottom: 20);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPadding);
    final state = AppState(autoLoad: false);
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: ProductDetailScreen(
            product: _product, state: state, onBuyNow: () {})));
    await tester.pumpAndSettle();
    expect(
        tester.getTopLeft(find.byTooltip('Back')).dy, greaterThanOrEqualTo(34));
    expect(find.byKey(const ValueKey('product-status-scrim')), findsOneWidget);
    expect(find.byTooltip('Save product').hitTestable(), findsOneWidget);
    expect(find.text('Add to bag').hitTestable(), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });
}
