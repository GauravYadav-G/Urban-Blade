import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/models/product_model.dart';
import 'package:urban_blade_mobile/core/services/api_service.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';

const _user = {
  'id': 'customer-1',
  'name': 'Alex',
  'email': 'alex@example.com',
  'phone': '9876543210',
};
const _service = {
  'id': '4ce629c0-e15a-4128-a4ef-0101aa6f0647',
  'name': 'Precision Haircut',
  'price': 499,
  'kind': 'service',
  'category': 'services',
  'highlights': ['45 min'],
  'inStock': true,
};
const _product = ProductModel(
  id: 'product-1',
  name: 'Shampoo',
  price: 299,
  imageUrl: '',
  category: 'hair',
  description: '',
);
http.Response _json(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status);

class _DelayedProfileApi extends ApiService {
  final update = Completer<Map<String, dynamic>>();
  @override
  Future<Map<String, dynamic>> updateProfile(String name, String phone) =>
      update.future;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('availability rejects malformed responses with an actionable error',
      () async {
    for (final body in [
      'not json',
      '[]',
      '{}',
      '{"availableSlots":null}',
      '{"availableSlots":[null]}',
      '{"availableSlots":[" "]}'
    ]) {
      final client = MockClient((_) async => http.Response(body, 200));
      addTearDown(client.close);
      final api = ApiService(client: client);
      await expectLater(
          api.fetchAvailableSlots('', '2026-10-15'),
          throwsA(isA<ApiException>().having((error) => error.message,
              'message', contains('choose another date'))));
    }
  });

  test('availability accepts no slots and removes duplicate time choices',
      () async {
    for (final slots in [
      <String>[],
      ['10:00 AM', ' 10:00 AM ', '11:00 AM']
    ]) {
      final client = MockClient((_) async => _json({'availableSlots': slots}));
      addTearDown(client.close);
      final api = ApiService(client: client);
      expect(await api.fetchAvailableSlots('', '2026-10-15'),
          slots.isEmpty ? isEmpty : ['10:00 AM', '11:00 AM']);
    }
  });

  test('service catalog uses the server filter and accepts an empty menu',
      () async {
    var reads = 0;
    final api = ApiService(client: MockClient((request) async {
      reads++;
      expect(request.url.queryParameters['cat'], 'services');
      expect(request.url.queryParameters.containsKey('category'), false);
      return _json({'data': []});
    }));
    expect(await api.fetchServices(), isEmpty);
    expect(await api.fetchServices(), isEmpty);
    expect(reads, 1);
  });

  test('catalog separates services and reads numeric database fields',
      () async {
    final api = ApiService(
        client: MockClient((request) async => _json({
              'data': [
                null,
                {..._service, 'price': '499.00'},
                {..._service, 'id': 'unavailable', 'inStock': false},
                {
                  'id': 7,
                  'name': 'Shampoo',
                  'price': '299.00',
                  'compare_at_price': '399.00',
                  'review_count': '12',
                  'kind': 'retail',
                  'image_url': '/images/shampoo.jpg',
                },
              ]
            })));
    final products = await api.fetchProducts();
    expect(products.single.id, '7');
    expect(products.single.price, 299);
    expect(products.single.compareAtPrice, 399);
    expect(products.single.reviewCount, 12);
    final services = await api.fetchServices();
    expect(services.single.name, 'Precision Haircut');
    expect(services.single.price, 499);
  });

  test('cached products respect the requested page size', () async {
    final limits = <String>[];
    final api = ApiService(client: MockClient((request) async {
      limits.add(request.url.queryParameters['limit']!);
      return _json({
        'data': [_product.toJson()]
      });
    }));
    await api.fetchProducts(limit: 1);
    await api.fetchProducts(limit: 100);
    await api.fetchProducts(limit: 100);
    expect(limits, ['1', '100']);
  });

  test(
      'concurrent catalog readers share requests and refresh rejects old cache',
      () async {
    final response = Completer<http.Response>();
    var reads = 0;
    final api = ApiService(client: MockClient((request) async {
      reads++;
      if (reads == 1) return response.future;
      return _json({
        'data': [
          {..._product.toJson(), 'name': 'Updated Shampoo'}
        ]
      });
    }));
    final first = api.fetchProducts();
    final same = api.fetchProducts();
    expect(identical(first, same), true);
    await Future<void>.delayed(Duration.zero);
    expect(reads, 1);
    api.clearCatalogCache();
    expect((await api.fetchProducts()).single.name, 'Updated Shampoo');
    response.complete(_json({
      'data': [_product.toJson()]
    }));
    await first;
    expect((await api.fetchProducts()).single.name, 'Updated Shampoo');
    expect(reads, 2);
  });

  test('bookings work without customer staff selection and use server prices',
      () async {
    Map<String, dynamic>? submitted;
    final api = ApiService(client: MockClient((request) async {
      if (request.url.path.endsWith('/stylists')) return _json([]);
      if (request.url.path.endsWith('/products')) {
        return _json({
          'data':
              request.url.queryParameters['cat'] == 'services' ? [_service] : []
        });
      }
      if (request.url.path.endsWith('/available-slots')) {
        expect(request.url.queryParameters.containsKey('stylistId'), false);
        return _json({
          'availableSlots': ['10:00 AM']
        });
      }
      submitted = jsonDecode(request.body) as Map<String, dynamic>;
      expect(submitted!.containsKey('stylist_id'), false);
      expect(submitted!['service_id'], _service['id']);
      expect(submitted!['serviceName'], _service['name']);
      expect(submitted!['visit_type'], 'home');
      expect(submitted!['service_address'], '12 Main Road, Pune');
      return _json({
        'id': 'booking-1',
        'booking_date': '2026-10-15',
        'time_slot': '10:00 AM',
        'total_price': '549.00',
      }, 201);
    }))
      ..authToken = 'access';
    final state = AppState(api: api, autoLoad: false)
      ..isLoggedIn = true
      ..userName = 'Alex'
      ..userPhone = '9876543210'
      ..userEmail = 'alex@example.com';
    addTearDown(state.dispose);
    await state.loadRemoteData();
    expect(state.barbers, isEmpty);
    state.toggleServiceSelection(state.services.single.id);
    state.setSelectedTimeSlot(
        (await api.fetchAvailableSlots('', '2026-10-15')).single);
    final booking = await state.createBooking(
        locationType: 'home',
        address: '12 Main Road, Pune',
        date: '2026-10-15');
    expect(booking.totalAmount, 549);
    expect(booking.homeVisitFee, 0);
    expect(booking.studioOrHomeAddress, '12 Main Road, Pune');
    expect(booking.barber.name, 'Assigned by salon');
    expect(state.bookings.single.id, 'booking-1');
    await state.persistDraft();
  });

  test('appointment history reads structured visit and address fields',
      () async {
    final api = ApiService(
        client: MockClient(
            (request) async => _json(request.url.path.endsWith('/bookings')
                ? [
                    {
                      'id': 'booking-1',
                      'notes': 'Precision Haircut',
                      'visit_type': 'home',
                      'service_address': '12 Main Road, Pune',
                      'booking_date': '2026-10-15',
                      'time_slot': '10:00 AM',
                      'total_price': '499.00',
                      'status': 'confirmed',
                      'created_at': '2026-10-14T10:00:00Z',
                    }
                  ]
                : [])))
      ..authToken = 'access';
    final state = AppState(api: api, autoLoad: false)..isLoggedIn = true;
    addTearDown(state.dispose);
    await state.loadHistory();
    expect(state.historyError, isNull);
    expect(state.bookings.single.locationType, 'home');
    expect(state.bookings.single.studioOrHomeAddress, '12 Main Road, Pune');
    expect(state.bookings.single.service.name, 'Precision Haircut');
    expect(state.bookings.single.barber.name, 'Assigned by salon');
  });

  test('a late login response cannot restore a signed-out session', () async {
    final response = Completer<http.Response>();
    final api = ApiService(client: MockClient((_) => response.future));
    final signIn =
        api.authenticate(email: 'alex@example.com', password: 'secret');
    final rejected = expectLater(signIn, throwsA(isA<ApiException>()));
    await api.logout();
    response.complete(_json({'token': 'access', 'user': _user}));
    await rejected;
    expect(api.authToken, isNull);
    expect(api.cachedUser, isNull);
    expect(
        (await SharedPreferences.getInstance())
            .getString('urban_verified_token'),
        isNull);
  });

  test('old unauthorized response cannot expire a newer login', () async {
    final oldResponse = Completer<http.Response>();
    final api = ApiService(client: MockClient((request) async {
      if (request.url.path.endsWith('/login')) {
        return _json({'token': 'new-access', 'user': _user});
      }
      return oldResponse.future;
    }))
      ..authToken = 'old-access';
    final oldRequest = api.request('GET', 'orders');
    final rejected = expectLater(oldRequest, throwsA(isA<ApiException>()));
    await api.authenticate(email: 'alex@example.com', password: 'secret');
    oldResponse.complete(_json({'error': 'INVALID_TOKEN'}, 401));
    await rejected;
    expect(api.authToken, 'new-access');
    expect(api.cachedUser, _user);
  });

  test('late unauthorized responses reuse the already refreshed access token',
      () async {
    SharedPreferences.setMockInitialValues({
      'urban_verified_token': 'old-access',
      'urban_refresh_token': 'refresh',
      'urban_session_user': jsonEncode(_user),
    });
    var refreshes = 0;
    final lateResponse = Completer<http.Response>();
    final api = ApiService(client: MockClient((request) async {
      if (request.url.path.endsWith('/refresh')) {
        refreshes++;
        return _json({
          'token': 'new-access',
          'refreshToken': 'new-refresh',
          'user': _user
        });
      }
      if (request.url.path.endsWith('/me')) return _json({'user': _user});
      if (request.headers['Authorization'] == 'Bearer new-access') {
        return _json([]);
      }
      if (request.url.path.endsWith('/bookings')) return lateResponse.future;
      return _json({}, 401);
    }));
    await api.restoreSession();
    final late = api.fetchHistory('bookings');
    await api.fetchHistory('orders');
    lateResponse.complete(_json({}, 401));
    await late;
    expect(refreshes, 1);
    expect(api.authToken, 'new-access');
  });

  test('session expiry hides the previous account delivery and payment draft',
      () async {
    final api = ApiService(client: MockClient((_) async => _json({}, 401)))
      ..authToken = 'expired';
    final state = AppState(api: api, autoLoad: false)
      ..isLoggedIn = true
      ..addToCart(_product)
      ..pendingPayment = {'orderId': 'old-order'};
    addTearDown(state.dispose);
    await state.saveDelivery(
        name: 'Alex',
        phone: '9876543210',
        street: '12 Private Street',
        newCity: 'Pune',
        newRegion: 'Maharashtra',
        pin: '411001');
    await expectLater(
        api.request('GET', 'orders'), throwsA(isA<ApiException>()));
    expect(state.isLoggedIn, false);
    expect(state.cart, isEmpty);
    expect(state.homeAddress, isEmpty);
    expect(state.deliveryPhone, isEmpty);
    expect(state.pendingPayment, isNull);
    await state.persistDraft();
  });

  test('updated profile is available when restoring the account offline',
      () async {
    final api = ApiService(client: MockClient((request) async {
      if (request.method == 'PATCH') {
        return _json({
          'user': {..._user, 'name': 'Alex Updated'}
        });
      }
      throw http.ClientException('offline');
    }))
      ..authToken = 'access';
    SharedPreferences.setMockInitialValues({'urban_verified_token': 'access'});
    await api.updateProfile('Alex Updated', '9876543210');
    expect((await api.restoreSession())!['name'], 'Alex Updated');
  });

  test('a profile update completing after logout cannot restore the account',
      () async {
    final api = _DelayedProfileApi();
    final state = AppState(api: api, autoLoad: false)
      ..isLoggedIn = true
      ..userName = 'Alex';
    addTearDown(state.dispose);
    final update = state.updateProfile('Alex Updated', '9876543210');
    await state.logout();
    api.update.complete({..._user, 'name': 'Alex Updated'});
    await update;
    expect(state.isLoggedIn, false);
    expect(state.userName, 'Guest');
    expect(state.userEmail, isEmpty);
  });
}
