import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/core/models/product_model.dart';
import 'package:urban_blade_mobile/features/main_shell.dart';

void main() {
  testWidgets(
      'header profile opens account and cart quantities update on the pushed route',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final state = AppState(autoLoad: false)
      ..addToCart(const ProductModel(
          id: 'p1',
          name: 'Daily Shampoo',
          price: 299,
          imageUrl: '',
          category: 'hair',
          description: ''));
    await tester.pumpWidget(
        MaterialApp(theme: AppTheme.lightTheme, home: MainShell(state: state)));
    await tester.tap(find.byTooltip('My profile'));
    await tester.pumpAndSettle();
    expect(find.text('Sign in or create account'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.tap(find.byTooltip('Shopping cart'));
    await tester.pumpAndSettle();
    expect(find.text('My cart'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('plus-p1')));
    await tester.pumpAndSettle();
    expect(find.text('₹598'), findsOneWidget);
    expect(state.cartCount, 2);
    await tester.tap(find.byKey(const ValueKey('minus-p1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('minus-p1')));
    await tester.pumpAndSettle();
    expect(find.text('Good things belong here.'), findsOneWidget);
    await tester.tap(find.text('Explore the shop'));
    await tester.pumpAndSettle();
    expect(find.text('Daily care, upgraded.'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });
}
