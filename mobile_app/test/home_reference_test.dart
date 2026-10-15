import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/features/main_shell.dart';
import 'package:urban_blade_mobile/features/home/home_screen.dart';
import 'visual_preview_test.dart' show PreviewApi;

void main() {
  testWidgets('dashboard booking actions and cart sheet preserve the home flow',
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
        key: const ValueKey('home-preview'),
        child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: AppTheme.lightTheme,
            home: MainShell(state: state))));
    for (final asset in [
      'assets/images/heroes/care-editorial.png',
      'assets/images/products/hc-shampoo.jpg',
      'assets/images/products/beard-oil.jpg',
      'assets/images/heroes/booking-salon.png'
    ]) {
      await tester.runAsync(() => precacheImage(
          AssetImage(asset), tester.element(find.byType(MainShell))));
    }
    await tester.pumpAndSettle();
    await expectLater(find.byKey(const ValueKey('home-preview')),
        matchesGoldenFile('goldens/home-reference.png'));
    await tester.tap(find.byKey(const ValueKey('home-card-studio')));
    await tester.pumpAndSettle();
    expect(state.locationMode, 'studio');
    await tester.tap(find.byKey(const ValueKey('tab-0')));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.byTooltip('Add Beard Oil to bag'), 220,
        scrollable: find.byType(Scrollable).first);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byTooltip('Add Beard Oil to bag'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Add Beard Oil to bag'));
    await tester.pumpAndSettle();
    expect(state.cartCount, 1);
    await tester.drag(find.byType(CustomScrollView), const Offset(0, 1800));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Shopping cart'));
    await tester.pumpAndSettle();
    expect(find.text('My cart'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('plus-oil')));
    await tester.pumpAndSettle();
    expect(state.cartSubtotal, 898);
    await expectLater(find.byKey(const ValueKey('home-preview')),
        matchesGoldenFile('goldens/home-cart-sheet.png'));
    await tester.tap(find.byTooltip('Close cart'));
    await tester.pumpAndSettle();
    expect(find.byType(HomeScreen).hitTestable(), findsOneWidget);
    expect(find.text('My cart'), findsNothing);
    await tester.tap(find.byTooltip('Shopping cart'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign in to checkout'));
    await tester.pumpAndSettle();
    expect(find.text('My cart'), findsNothing);
    expect(find.text('New here? Create an account'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });

  testWidgets('home cart supports large text and reduced motion',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(320, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final state = AppState(api: PreviewApi(), autoLoad: false);
    await state.loadRemoteData();
    state.addToCart(state.products.first);
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
                disableAnimations: true,
                textScaler: const TextScaler.linear(2)),
            child: child!),
        home: MainShell(state: state)));
    await tester.pumpAndSettle();
    expect(find.text('What’s your ritual today?'), findsOneWidget);
    expect(find.byType(PageView), findsNothing);
    await tester.tap(find.byTooltip('Shopping cart'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const ValueKey('minus-oil')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('minus-oil')));
    await tester.pumpAndSettle();
    expect(state.cartCount, 0);
    await tester.ensureVisible(find.text('Explore the shop'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Explore the shop'));
    await tester.pumpAndSettle();
    expect(find.text('My cart'), findsNothing);
    expect(tester.takeException(), isNull);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });
}
