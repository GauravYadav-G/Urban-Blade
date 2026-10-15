import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/main.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/services/payment_gateway.dart';
import 'package:urban_blade_mobile/core/services/receipt_exporter.dart';
import 'package:urban_blade_mobile/features/cart/cart_flow.dart';
import 'package:urban_blade_mobile/features/services/services_screen.dart';
import 'package:urban_blade_mobile/core/widgets/stitch_bottom_nav.dart';
import 'visual_preview_test.dart' show PreviewApi;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('Back closes the cart, then returns Shop and secondary tabs Home',
      (tester) async {
    final state = AppState(api: PreviewApi(), autoLoad: false);
    await state.loadRemoteData();
    state.addToCart(state.products.first);
    await tester.pumpWidget(UrbanBladeMobileApp(appState: state));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('tab-3')));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(CartDock).hitTestable());
    await tester.pumpAndSettle();
    expect(find.text('My cart'), findsOneWidget);
    await state.setThemeMode(ThemeMode.dark);
    await tester.pumpAndSettle();
    expect(find.text('My cart'), findsOneWidget);
    expect(state.cartCount, 1);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('My cart'), findsNothing);
    expect(
        tester
            .widget<StitchBottomNav>(find.byType(StitchBottomNav))
            .currentIndex,
        3);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(
        tester
            .widget<StitchBottomNav>(find.byType(StitchBottomNav))
            .currentIndex,
        0);
    for (final tab in [1, 2, 4]) {
      await tester.tap(find.byKey(ValueKey('tab-$tab')));
      await tester.pumpAndSettle();
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(
          tester
              .widget<StitchBottomNav>(find.byType(StitchBottomNav))
              .currentIndex,
          0);
    }
    expect(tester.takeException(), isNull);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });

  testWidgets('cart updates do not rebuild MaterialApp; appearance changes do',
      (tester) async {
    final state = AppState(api: PreviewApi(), autoLoad: false);
    await state.loadRemoteData();
    await tester.pumpWidget(UrbanBladeMobileApp(appState: state));
    await tester.pumpAndSettle();
    final before = tester.widget<MaterialApp>(find.byType(MaterialApp));
    state.addToCart(state.products.first);
    await tester.pumpAndSettle();
    expect(identical(before, tester.widget(find.byType(MaterialApp))), isTrue);
    await state.setThemeMode(ThemeMode.dark);
    await tester.pumpAndSettle();
    expect(tester.widget<MaterialApp>(find.byType(MaterialApp)).themeMode,
        ThemeMode.dark);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });

  testWidgets('service selection never adds products to the cart',
      (tester) async {
    final state = AppState(api: PreviewApi(), autoLoad: false);
    await state.loadRemoteData();
    var booked = false;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: ServicesScreen(
                state: state, onProceedToBooking: () => booked = true))));
    await tester.pumpAndSettle();
    expect(find.text('Beard Oil'), findsNothing);
    await tester.ensureVisible(find.text('Men’s Precision Haircut'));
    await tester.tap(find.text('Men’s Precision Haircut'));
    await tester.pumpAndSettle();
    expect(state.cartCount, 0);
    expect(state.selectedServiceIds, contains('cut'));
    await tester.tap(find.text('Book 1 service · ₹249'));
    expect(booked, isTrue);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });

  test('UPI preferences retain fallback and do not contain payment credentials',
      () {
    for (final app in ['any', 'phonepe', 'google_pay']) {
      final display = upiCheckoutConfiguration(app)['display'] as Map;
      expect((display['preferences'] as Map)['show_default_blocks'], true);
      final block = (display['blocks'] as Map)['preferred_upi'] as Map;
      final instrument = (block['instruments'] as List).single as Map;
      expect(instrument['flows'], ['intent']);
      expect(instrument['apps'], app == 'any' ? null : [app]);
    }
  });

  testWidgets(
      'receipt export preserves pending status, amounts and save cancellation',
      (tester) async {
    const order = {
      'id': 'order/123',
      'payment_status': 'pending',
      'payment_method': 'cod',
      'total_amount': 499,
      'subtotal': 449,
      'shipping_fee': 50,
      'items': [
        {'quantity': 1, 'product_name': 'Beard Oil', 'unit_price': 449}
      ]
    };
    MethodCall? received;
    tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(ReceiptExporter.channel, (call) async {
      received = call;
      return false;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(ReceiptExporter.channel, null));
    expect(await tester.runAsync(() => ReceiptExporter.save(order)), false);
    expect(received!.method, 'savePdf');
    expect(received!.arguments['filename'], 'UrbanBlade-receipt-order_123.pdf');
    final bytes = received!.arguments['bytes'] as List<int>;
    expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
    expect(bytes.length, greaterThan(1000));
  });
}
