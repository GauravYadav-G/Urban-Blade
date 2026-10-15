import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/services/api_service.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/models/product_model.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/features/orders/orders_screen.dart';
import 'package:urban_blade_mobile/features/cart/cart_screen.dart';

class CommerceApi extends ApiService {
  String status = 'dispatched';
  int calls = 0;
  bool failReceipt = true;
  @override
  Future<dynamic> request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    String? key,
  }) async {
    if (failReceipt) throw Exception('Offline');
    return (await fetchHistory('orders')).first;
  }

  @override
  Future<List<dynamic>> fetchHistory(String resource) async {
    if (resource != 'orders') return [];
    calls++;
    return [
      {
        'id': 'UB-2026-1042',
        'items': [
          {
            'product_id': 'oil',
            'product_name': 'Sandalwood Beard Oil',
            'unit_price': 449,
            'quantity': 1,
            'image_url': 'assets/images/products/beard-oil.jpg',
          },
        ],
        'subtotal': 449,
        'shipping_fee': 49,
        'total_amount': 498,
        'payment_method': 'Razorpay',
        'payment_status': 'captured',
        'transaction_id': 'pay_1042',
        'tracking_number': 'UBTRACK1042',
        'status': status,
        'shipping_address': {'street': '12 Main Road', 'city': 'Pune'},
        'created_at': '2026-10-06T10:00:00Z',
      },
      {
        'id': 'UB-2026-1038',
        'items': [
          {
            'product_id': 'shampoo',
            'product_name': 'Daily Care Shampoo',
            'unit_price': 349,
            'quantity': 1,
            'image_url': 'assets/images/products/hc-shampoo.jpg',
          },
        ],
        'subtotal': 349,
        'total_amount': 349,
        'payment_method': 'Cash on Delivery',
        'payment_status': 'pending',
        'status': 'confirmed',
        'shipping_address': {'street': '12 Main Road', 'city': 'Pune'},
        'created_at': '2026-10-05T10:00:00Z',
      },
    ];
  }
}

void main() {
  testWidgets(
    'commerce previews and live tracking keep payment and delivery separate',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      debugDisableShadows = false;
      addTearDown(() => debugDisableShadows = true);
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await (FontLoader(
        'PlusJakartaSans',
      )..addFont(rootBundle.load('assets/fonts/PlusJakartaSans.ttf'))).load();
      await (FontLoader(
        'CormorantGaramond',
      )..addFont(rootBundle.load('assets/fonts/CormorantGaramond.ttf'))).load();
      await (FontLoader(
        'MaterialIcons',
      )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
      final api = CommerceApi();
      final state = AppState(api: api, autoLoad: false)..isLoggedIn = true;
      await state.loadHistory();
      expect(state.orders.first.deliveryFee, 49);
      await tester.pumpWidget(
        RepaintBoundary(
          key: const ValueKey('capture-commerce'),
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            debugShowCheckedModeBanner: false,
            home: OrdersScreen(state: state, onShopNew: () {}),
          ),
        ),
      );
      for (final asset in [
        'assets/images/products/beard-oil.jpg',
        'assets/images/products/hc-shampoo.jpg',
      ]) {
        await tester.runAsync(
          () => precacheImage(
            AssetImage(asset),
            tester.element(find.byType(OrdersScreen)),
          ),
        );
      }
      await tester.pumpAndSettle();
      await expectLater(
        find.byKey(const ValueKey('capture-commerce')),
        matchesGoldenFile('goldens/orders.png'),
      );
      await tester.tap(find.text('Payments'));
      await tester.pumpAndSettle();
      await expectLater(
        find.byKey(const ValueKey('capture-commerce')),
        matchesGoldenFile('goldens/payments.png'),
      );
      await tester.tap(find.widgetWithText(ChoiceChip, 'Pending'));
      await tester.pumpAndSettle();
      expect(find.text('₹349.00'), findsOneWidget);
      expect(
        find.text('₹498.00'),
        findsOneWidget,
      ); // paid summary remains independent of the filter
      await tester.tap(find.text('Orders'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Track order').first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Track order').first);
      await tester.pumpAndSettle();
      await expectLater(
        find.byKey(const ValueKey('capture-commerce')),
        matchesGoldenFile('goldens/tracking.png'),
      );
      api.status = 'delivered';
      final previousCalls = api.calls;
      await tester.pump(const Duration(seconds: 31));
      await tester.pumpAndSettle();
      expect(api.calls, greaterThan(previousCalls));
      expect(find.text('Delivered'), findsWidgets);
      await tester.drag(find.byType(ListView).last, const Offset(0, -1200));
      await tester.pumpAndSettle();
      await tester.tap(find.text('View order receipt'));
      await tester.pumpAndSettle();
      expect(find.text('Receipt unavailable'), findsOneWidget);
      api.failReceipt = false;
      await tester.tap(find.text('Retry receipt'));
      await tester.pumpAndSettle();
      expect(find.text('₹498.00'), findsWidgets);
      await expectLater(
        find.byKey(const ValueKey('capture-commerce')),
        matchesGoldenFile('goldens/receipt.png'),
      );

      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      state.dispose();
      debugDisableShadows = true;
    },
  );

  testWidgets('cart controls fit a narrow phone with large text', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(320, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final state = AppState(autoLoad: false)
      ..addToCart(
        const ProductModel(
          id: 'oil',
          name: 'Sandalwood Beard Oil',
          price: 449,
          imageUrl: '',
          category: 'beard',
          description: '',
        ),
      );
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.lightTheme,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.5)),
          child: child!,
        ),
        home: Scaffold(
          body: CartScreen(
            state: state,
            onProceedToCheckout: () {},
            onContinueShopping: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const ValueKey('plus-oil')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('plus-oil')));
    await tester.pumpAndSettle();
    expect(state.cartCount, 2);
    expect(tester.takeException(), isNull);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
    debugDisableShadows = true;
  });
}
