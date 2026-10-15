import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/features/shop/shop_screen.dart';
import 'package:urban_blade_mobile/features/shop/product_detail_screen.dart';
import 'visual_preview_test.dart' show PreviewApi;

void main() {
  testWidgets('search and saved filter work on a small phone with large text',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(320, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final state = AppState(api: PreviewApi(), autoLoad: false);
    await state.loadRemoteData();
    Widget host(Widget child) => MaterialApp(
        theme: AppTheme.lightTheme,
        builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: const TextScaler.linear(1.6)),
            child: child!),
        home: child);
    await tester.pumpWidget(host(Scaffold(
        body: ShopScreen(
            state: state, onProductSelected: (_) {}, onOpenCart: () {}))));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'beard');
    await tester.pumpAndSettle();
    expect(find.text('1 essentials'), findsOneWidget);
    await tester.tap(find.byTooltip('Clear search'));
    await tester.pumpAndSettle();
    state.toggleWishlist('oil');
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -450));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Saved'));
    await tester.pumpAndSettle();
    expect(find.text('1 essentials'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(host(ProductDetailScreen(
        product: state.products.first, state: state, onBuyNow: () {})));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Add to bag'));
    await tester.pumpAndSettle();
    expect(state.cartCount, 1);
    expect(tester.takeException(), isNull);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });
}
