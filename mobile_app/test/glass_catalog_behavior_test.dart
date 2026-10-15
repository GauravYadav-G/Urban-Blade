import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/core/widgets/product_card.dart';
import 'package:urban_blade_mobile/features/home/home_screen.dart';
import 'package:urban_blade_mobile/features/shop/shop_screen.dart';
import 'visual_preview_test.dart' show PreviewApi;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
      'short and long product names keep caption actions aligned in two columns',
      (tester) async {
    tester.view.physicalSize = const Size(360, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await (FontLoader('PlusJakartaSans')
          ..addFont(rootBundle.load('assets/fonts/PlusJakartaSans.ttf')))
        .load();
    final state = AppState(api: PreviewApi(), autoLoad: false);
    addTearDown(state.dispose);
    await state.loadRemoteData();
    var opened = 0;
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.lightTheme,
      builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(disableAnimations: true),
          child: child!),
      home: Scaffold(
          body: Padding(
              padding: const EdgeInsets.all(20),
              child:
                  Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                for (var index = 0; index < state.products.length; index++) ...[
                  if (index > 0) const SizedBox(width: 14),
                  Expanded(
                      child: ProductCard(
                          product: state.products[index],
                          saved: false,
                          onOpen: () => opened++,
                          onSave: () =>
                              state.toggleWishlist(state.products[index].id),
                          onAdd: () => state.addToCart(state.products[index]))),
                ],
              ]))),
    ));
    await tester.pumpAndSettle();
    final oil = find.byTooltip('Add Beard Oil to bag');
    final shampoo = find.byTooltip('Add Daily Care Shampoo to bag');
    expect(tester.getRect(oil).top, closeTo(tester.getRect(shampoo).top, .01));
    final cards = find.byType(ProductCard).evaluate().toList();
    expect(tester.getSize(find.byWidget(cards.first.widget)).height,
        closeTo(tester.getSize(find.byWidget(cards.last.widget)).height, .01));
    await tester.tap(oil);
    await tester.pumpAndSettle();
    expect(state.cartCount, 1);
    expect(opened, 0);
    await tester.tap(find.text('Daily Care Shampoo'));
    expect(opened, 1);
    expect(tester.takeException(), isNull);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
  });

  for (final highContrast in [false, true]) {
    testWidgets(
        'all dashboard actions fit bundled fonts at 320px and 2x text, highContrast=$highContrast',
        (tester) async {
      tester.view.physicalSize = const Size(320, 720);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await (FontLoader('PlusJakartaSans')
            ..addFont(rootBundle.load('assets/fonts/PlusJakartaSans.ttf')))
          .load();
      await (FontLoader('CormorantGaramond')
            ..addFont(rootBundle.load('assets/fonts/CormorantGaramond.ttf')))
          .load();
      final state = AppState(api: PreviewApi(), autoLoad: false);
      addTearDown(state.dispose);
      await state.loadRemoteData();
      var services = 0, bookings = 0;
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
              textScaler: const TextScaler.linear(2),
              disableAnimations: true,
              highContrast: highContrast),
          child: child!,
        ),
        home: Scaffold(
            body: HomeScreen(
                state: state,
                onNavigateToServices: () => services++,
                onNavigateToBook: () => bookings++,
                onNavigateToShop: () {},
                onSelectProduct: (_) {})),
      ));
      await tester.pumpAndSettle();
      for (final mode in ['services', 'studio', 'home']) {
        final action = find.byKey(ValueKey('home-card-$mode'));
        await tester.ensureVisible(action);
        await tester.pumpAndSettle();
        await tester.tap(action);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      }
      expect(services, 1);
      expect(bookings, 2);
      expect(state.locationMode, 'home');
      await state.persistDraft();
      await tester.pumpWidget(const SizedBox());
    });
  }

  for (final dark in [false, true]) {
    testWidgets(
        'glass catalog sorting and search work at 320px with 2x text, dark=$dark',
        (tester) async {
      tester.view.physicalSize = const Size(320, 720);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);
      final state = AppState(api: PreviewApi(), autoLoad: false);
      addTearDown(state.dispose);
      await state.loadRemoteData();
      await tester.pumpWidget(MaterialApp(
        theme: dark ? AppTheme.darkTheme : AppTheme.lightTheme,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
              textScaler: const TextScaler.linear(2), disableAnimations: true),
          child: child!,
        ),
        home: Scaffold(
            body: ShopScreen(
                state: state, onProductSelected: (_) {}, onOpenCart: () {})),
      ));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.byTooltip('Sort products'), 100,
          scrollable: find.byType(Scrollable).first);
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Sort products'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Price: high to low'));
      await tester.pumpAndSettle();
      expect(find.text('Price: high to low'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.byType(TextField));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'beard');
      tester.view.viewInsets = const FakeViewPadding(bottom: 260);
      await tester.pumpAndSettle();
      expect(find.text('1 essentials'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await state.persistDraft();
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets(
        'dashboard service tile remains actionable with reduced motion, dark=$dark',
        (tester) async {
      tester.view.physicalSize = const Size(320, 720);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final state = AppState(api: PreviewApi(), autoLoad: false);
      addTearDown(state.dispose);
      await state.loadRemoteData();
      var services = 0;
      await tester.pumpWidget(MaterialApp(
        theme: dark ? AppTheme.darkTheme : AppTheme.lightTheme,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
              textScaler: const TextScaler.linear(2), disableAnimations: true),
          child: child!,
        ),
        home: Scaffold(
            body: HomeScreen(
                state: state,
                onNavigateToServices: () => services++,
                onNavigateToBook: () {},
                onNavigateToShop: () {},
                onSelectProduct: (_) {})),
      ));
      await tester.pumpAndSettle();
      final action = find.byKey(const ValueKey('home-card-services'));
      await tester.scrollUntilVisible(action, 100,
          scrollable: find.byType(Scrollable).first);
      await tester.pumpAndSettle();
      await tester.ensureVisible(action);
      await tester.pumpAndSettle();
      expect(action.hitTestable(), findsOneWidget);
      await tester.tap(action);
      await tester.pumpAndSettle();
      expect(services, 1);
      expect(tester.takeException(), isNull);
      await state.persistDraft();
      await tester.pumpWidget(const SizedBox());
    });
  }
}
