import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/features/main_shell.dart';
import 'package:urban_blade_mobile/features/shop/product_detail_screen.dart';
import 'package:urban_blade_mobile/features/shop/shop_screen.dart';
import 'visual_preview_test.dart' show PreviewApi;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
      'shop product opens, adds to bag and returns through a hero flight',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final state = AppState(api: PreviewApi(), autoLoad: false);
    await state.loadRemoteData();
    addTearDown(state.dispose);
    await tester.pumpWidget(
        MaterialApp(theme: AppTheme.lightTheme, home: MainShell(state: state)));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('tab-3')));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Beard Oil'), 100,
        scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Beard Oil'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(tester.takeException(), isNull);
    await tester.pumpAndSettle();
    expect(find.byType(ProductDetailScreen), findsOneWidget);
    expect(find.text('Add to bag').hitTestable(), findsOneWidget);
    final catalog = tester.widget(find.byType(ShopScreen, skipOffstage: false));
    await tester.tap(find.byTooltip('Save product'));
    await tester.pumpAndSettle();
    expect(state.wishlist, contains('oil'));
    expect(
        identical(catalog,
            tester.widget(find.byType(ShopScreen, skipOffstage: false))),
        isTrue);
    await tester.tap(find.text('Add to bag'));
    await tester.pumpAndSettle();
    expect(state.cartCount, 1);
    expect(find.byType(ProductDetailScreen), findsNothing);
    expect(tester.takeException(), isNull);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
  });
}
