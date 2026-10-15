import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/models/product_model.dart';
import 'package:urban_blade_mobile/core/models/service_model.dart';
import 'package:urban_blade_mobile/core/services/api_service.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';

const _product = ProductModel(
    id: 'product-1',
    name: 'Shampoo',
    price: 299,
    imageUrl: '',
    category: 'hair',
    description: '');
const _service = ServiceModel(
    id: 'service-1',
    name: 'Haircut',
    duration: '45 min',
    price: 499,
    description: '',
    category: 'hair');
const _payment = {
  'orderId': 'old-order',
  'razorpayOrderId': 'remote-order',
  'keyId': 'key',
  'amount': 39800
};
const _receipt = {
  'orderId': 'old-order',
  'success': true,
  'paymentStatus': 'captured',
  'totalAmount': 398
};

/// Defers parsed API responses so state boundaries are tested independently of
/// the HTTP transport's own session cancellation checks.
class _DelayedActionApi extends ApiService {
  _DelayedActionApi()
      : super(client: MockClient((_) async => http.Response('{}', 200)));
  String account = 'customer-1';
  final responses = <String, Completer<Object>>{};
  final requested = <String, Completer<void>>{};
  Future<void> whenRequested(String path) =>
      requested.putIfAbsent(path, Completer<void>.new).future;
  Completer<Object> defer(String path) =>
      responses.putIfAbsent(path, Completer<Object>.new);

  @override
  Future<dynamic> request(String method, String path,
      {Map<String, dynamic>? body, String? key}) async {
    if (responses.containsKey(path) && method == 'POST') {
      final signal = requested.putIfAbsent(path, Completer<void>.new);
      if (!signal.isCompleted) signal.complete();
      return responses[path]!.future;
    }
    if (path == 'auth/login') {
      return {
        'token': 'access-$account',
        'user': {
          'id': account,
          'name': 'Alex',
          'email': 'alex@example.com',
          'phone': '9876543210'
        }
      };
    }
    if (path == 'auth/cart') return {'items': []};
    if (path == 'orders/quote') {
      return {'totalAmount': 398, 'subtotal': 299, 'shippingFee': 99};
    }
    return [];
  }
}

Future<AppState> _signedIn(_DelayedActionApi api) async {
  final state = AppState(api: api, autoLoad: false);
  await state.signIn(email: 'alex@example.com', password: 'password');
  await Future<void>.delayed(Duration.zero);
  state.addToCart(_product);
  await state.persistDraft();
  return state;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('a late booking success cannot populate guest history after logout',
      () async {
    final api = _DelayedActionApi();
    final result = api.defer('bookings');
    final state = await _signedIn(api);
    addTearDown(state.dispose);
    final booking =
        state.createBooking(service: _service, timeSlot: '10:00 AM');
    final rejected = expectLater(booking, throwsA(isA<ApiException>()));
    await api.whenRequested('bookings');
    await state.logout();
    result.complete({'id': 'old-booking', 'total_price': 499});
    await rejected;
    expect(state.isLoggedIn, false);
    expect(state.bookings, isEmpty);
  });

  for (final action in ['cod', 'create', 'verify', 'reconcile']) {
    test('late $action result cannot change a newly signed-in account',
        () async {
      final paths = {
        'cod': 'orders/cod-order',
        'create': 'orders/razorpay/create-order',
        'verify': 'orders/razorpay/verify',
        'reconcile': 'orders/old-order/reconcile'
      };
      final api = _DelayedActionApi();
      final path = paths[action]!;
      final result = api.defer(path);
      final state = await _signedIn(api);
      addTearDown(state.dispose);
      if (action == 'verify' || action == 'reconcile') {
        state.pendingPayment = Map<String, dynamic>.from(_payment);
        await state.persistDraft();
      }
      final Future<Object?> operation = switch (action) {
        'cod' => state.placeCodOrder(),
        'create' => state.createRazorpayOrder(),
        'verify' => state.finalizeRazorpayOrder(
            orderId: 'old-order',
            razorpayOrderId: 'remote-order',
            razorpayPaymentId: 'payment',
            razorpaySignature: 'signature',
            amountInPaise: 39800),
        _ => state.checkPendingPayment(),
      };
      final rejected = expectLater(operation, throwsA(isA<ApiException>()));
      await api.whenRequested(path);
      await state.logout();
      api.account = 'customer-2';
      await state.signIn(email: 'second@example.com', password: 'password');
      await Future<void>.delayed(Duration.zero);
      state.addToCart(_product, qty: 2);
      await state.persistDraft();
      result.complete(switch (action) {
        'cod' => {'success': true, 'orderId': 'old-order'},
        'create' => _payment,
        'verify' => _receipt,
        _ => {'receipt': _receipt},
      });
      await rejected;
      expect(state.isLoggedIn, true);
      expect(state.api.currentUserId, 'customer-2');
      expect(state.orders, isEmpty);
      expect(state.cartCount, 2);
      expect(state.pendingPayment, isNull);
      await state.persistDraft();
      if (action != 'cod') {
        final draft = jsonDecode((await SharedPreferences.getInstance())
            .getString('urban_draft_customer-1')!);
        expect(draft['payment']['orderId'], 'old-order');
        final newDraft = jsonDecode((await SharedPreferences.getInstance())
            .getString('urban_draft_customer-2')!);
        expect(newDraft['payment'], isNull);
      }
    });
  }

  test('a quote arriving after logout cannot replace guest checkout state',
      () async {
    final api = _DelayedActionApi();
    final result = api.defer('orders/quote');
    final state = await _signedIn(api);
    addTearDown(state.dispose);
    final operation = state.getAuthoritativeQuote();
    final rejected = expectLater(operation, throwsA(isA<ApiException>()));
    await api.whenRequested('orders/quote');
    await state.logout();
    result.complete({'totalAmount': 398});
    await rejected;
    expect(state.checkoutQuote, isNull);
    expect(state.isLoggedIn, false);
  });
}
