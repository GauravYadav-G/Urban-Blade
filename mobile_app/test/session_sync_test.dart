import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/services/api_service.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/models/product_model.dart';

const user = {
  'id': 'customer-1',
  'name': 'Alex',
  'email': 'alex@example.com',
  'phone': '9876543210'
};
const product = ProductModel(
    id: 'p1',
    name: 'Beard Oil',
    price: 449,
    imageUrl: '',
    category: 'beard',
    description: 'Everyday care');
http.Response jsonResponse(Object data, [int status = 200]) =>
    http.Response(jsonEncode(data), status,
        headers: {'content-type': 'application/json'});

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));
  test('temporary connection failure retains saved session and never logs out',
      () async {
    SharedPreferences.setMockInitialValues({
      'urban_verified_token': 'access',
      'urban_refresh_token': 'refresh',
      'urban_session_user': jsonEncode(user)
    });
    final paths = <String>[];
    final api = ApiService(client: MockClient((req) async {
      paths.add(req.url.path);
      throw http.ClientException('offline');
    }));
    expect(await api.restoreSession(), user);
    expect(api.authToken, 'access');
    expect(
        (await SharedPreferences.getInstance())
            .getString('urban_verified_token'),
        'access');
    expect(paths, ['/api/auth/me']);
  });
  test('expired access refreshes once and retries authenticated request',
      () async {
    SharedPreferences.setMockInitialValues({
      'urban_verified_token': 'expired',
      'urban_refresh_token': 'refresh',
      'urban_session_user': jsonEncode(user)
    });
    var refreshes = 0;
    final api = ApiService(client: MockClient((req) async {
      if (req.url.path.endsWith('/refresh')) {
        refreshes++;
        expect(jsonDecode(req.body)['refreshToken'], 'refresh');
        return jsonResponse({
          'token': 'new-access',
          'refreshToken': 'new-refresh',
          'user': user
        });
      }
      if (req.headers['Authorization'] == 'Bearer expired') {
        return jsonResponse({'error': 'INVALID_TOKEN'}, 401);
      }
      expect(req.headers['Authorization'], 'Bearer new-access');
      return jsonResponse({'user': user});
    }));
    expect(await api.restoreSession(), user);
    expect(refreshes, 1);
    expect(
        (await SharedPreferences.getInstance())
            .getString('urban_refresh_token'),
        'new-refresh');
  });
  test('server errors retain actionable gateway message and code', () async {
    final api = ApiService(
        client: MockClient((_) async => jsonResponse({
              'error': 'PAYMENT_UNAVAILABLE',
              'message': 'Online payments are not configured.'
            }, 503)));
    await expectLater(
        api.request('POST', 'orders/razorpay/create-order'),
        throwsA(isA<ApiException>()
            .having((e) => e.message, 'message',
                'Online payments are not configured.')
            .having((e) => e.code, 'code', 'PAYMENT_UNAVAILABLE')));
  });
  test(
      'guest cart is merged with website cart and persisted using website schema',
      () async {
    List<dynamic> saved = [];
    final api = ApiService(client: MockClient((req) async {
      if (req.url.path.endsWith('/login')) {
        return jsonResponse(
            {'token': 'access', 'refreshToken': 'refresh', 'user': user});
      }
      if (req.url.path.endsWith('/auth/cart') && req.method == 'GET') {
        return jsonResponse({
          'items': [
            {
              'lineId': 'p2',
              'productId': 'p2',
              'name': 'Shampoo',
              'unitPrice': 299,
              'qty': 2,
              'imageUrl': ''
            }
          ]
        });
      }
      if (req.url.path.endsWith('/auth/cart')) {
        saved = jsonDecode(req.body)['items'];
        return jsonResponse({'ok': true});
      }
      return jsonResponse([]);
    }));
    final state = AppState(api: api, autoLoad: false)..addToCart(product);
    await state.persistDraft();
    await state.signIn(email: 'alex@example.com', password: 'a-password');
    // Background sync must complete without delaying successful authentication.
    for (var i = 0; i < 20 && saved.isEmpty; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    expect(state.cartCount, 3);
    expect(saved.map((i) => i['productId']).toSet(), {'p1', 'p2'});
    expect(saved.first['currency'], 'INR');
    expect(saved.first.containsKey('unitPrice'), true);
    await state.persistDraft();
    final draft = jsonDecode((await SharedPreferences.getInstance())
        .getString('urban_draft_customer-1')!);
    expect(draft['cart'].length, 2);
    expect(draft['dirty'], false);
    state.dispose();
  });
  test('login completes while history remains slow', () async {
    final slow = Completer<http.Response>();
    final api = ApiService(client: MockClient((req) async {
      if (req.url.path.endsWith('/login')) {
        return jsonResponse(
            {'token': 'access', 'refreshToken': 'refresh', 'user': user});
      }
      if (req.url.path.endsWith('/auth/cart')) {
        return jsonResponse({'items': []});
      }
      return slow.future;
    }));
    final state = AppState(api: api, autoLoad: false);
    await state
        .signIn(email: 'alex@example.com', password: 'a-password')
        .timeout(const Duration(seconds: 1));
    expect(state.isLoggedIn, true);
    expect(state.isLoadingHistory, true);
    slow.complete(jsonResponse([]));
    await Future<void>.delayed(const Duration(milliseconds: 10));
    state.dispose();
  });
  test(
      'pending payment survives restart and server reconciliation clears cart only on capture',
      () async {
    SharedPreferences.setMockInitialValues({
      'urban_verified_token': 'access',
      'urban_session_user': jsonEncode(user),
      'urban_draft_customer-1': jsonEncode({
        'cart': [CartItem(product: product, quantity: 1).toJson()],
        'payment': {
          'orderId': 'o1',
          'razorpayOrderId': 'r1',
          'keyId': 'key',
          'amount': 44900
        }
      })
    });
    var captured = false;
    final api = ApiService(client: MockClient((req) async {
      if (req.url.path.endsWith('/auth/me')) {
        return jsonResponse({'user': user});
      }
      if (req.url.path.endsWith('/reconcile')) {
        return jsonResponse(captured
            ? {
                'receipt': {
                  'success': true,
                  'paymentStatus': 'captured',
                  'orderId': 'o1',
                  'totalAmount': 449,
                  'subtotal': 449,
                  'items': [],
                  'shippingAddress': {}
                }
              }
            : {'pending': true});
      }
      if (req.url.path.contains('/products')) return jsonResponse({'data': []});
      if (req.url.path.endsWith('/auth/cart')) {
        return jsonResponse({'items': []});
      }
      return jsonResponse([]);
    }));
    final state = AppState(api: api, autoLoad: false);
    await state.initialize();
    expect(state.pendingPayment!['orderId'], 'o1');
    expect(await state.checkPendingPayment(), isNull);
    expect(state.cartCount, 1);
    captured = true;
    expect((await state.checkPendingPayment())!.id, 'o1');
    expect(state.cartCount, 0);
    expect(state.pendingPayment, isNull);
    await state.syncCart();
    state.dispose();
  });
}
