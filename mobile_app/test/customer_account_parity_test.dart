import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:urban_blade_mobile/features/profile/profile_screen.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/models/address_model.dart';
import 'package:urban_blade_mobile/core/models/order_model.dart';
import 'package:urban_blade_mobile/core/models/order_return_model.dart';
import 'package:urban_blade_mobile/core/services/api_service.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/features/profile/address_book_screen.dart';
import 'package:urban_blade_mobile/features/orders/order_aftercare.dart';
import 'package:urban_blade_mobile/features/appointments/appointments_screen.dart';

Map<String, dynamic> orderData([Map<String, dynamic> updates = const {}]) => {
  'id': 'order-1',
  'status': 'delivered',
  'subtotal': '824.65',
  'total_amount': '824.65',
  'payment_method': 'Razorpay',
  'payment_status': 'captured',
  'currency': 'INR',
  'created_at': '2026-10-14T10:00:00Z',
  'shipping_address': '{"street":"12 Main Road","pinCode":"110001"}',
  'items': [
    {
      'product_id': 'oil',
      'product_name': 'Beard Oil',
      'unit_price': '412.325',
      'quantity': 2,
    },
  ],
  ...updates,
};
const home = SavedAddress(
  id: 'home',
  fullName: 'Alice',
  mobile: '9811223344',
  street: '12 Main Road',
  pinCode: '110001',
  city: 'Delhi',
  region: 'Delhi',
  isDefault: true,
);
const office = SavedAddress(
  id: 'office',
  fullName: 'Alice Office',
  mobile: '9811223344',
  street: '24 Office Road',
  pinCode: '110002',
  city: 'Delhi',
  region: 'Delhi',
);
Map<String, dynamic> addressJson(SavedAddress address) => {
  'id': address.id,
  ...address.toJson(),
};

class AccountApi extends ApiService {
  AccountApi() {
    authToken = 'test';
    currentUserId = 'customer-a';
  }
  List<SavedAddress> saved = [home, office];
  List<Map<String, dynamic>> orders = [orderData()];
  final booking = <String, dynamic>{
    'id': 'booking-1',
    'booking_date': '2099-10-20',
    'time_slot': '10:00 AM',
    'status': 'confirmed',
    'total_price': 499,
    'notes': 'Haircut',
    'created_at': '2026-10-14T10:00:00Z',
    'visit_type': 'salon',
  };
  final calls = <String>[];
  Completer<Object?>? pendingReturn, pendingSchedule;
  Completer<List<SavedAddress>>? pendingAddress;
  Map<String, dynamic>? submitted;
  @override
  Future<Map<String, dynamic>> authenticate({
    required String email,
    required String password,
    String? name,
    String? phone,
  }) async {
    authToken = 'test';
    currentUserId = 'customer-a';
    return {
      'id': 'customer-a',
      'name': 'Alice',
      'email': email,
      'phone': '9811223344',
    };
  }

  @override
  Future<List<dynamic>> fetchCart() async => [];
  @override
  Future<void> saveCart(List<Map<String, dynamic>> items) async {}
  @override
  Future<List<dynamic>> fetchHistory(String resource) async =>
      resource == 'orders' ? orders : [booking];
  @override
  Future<List<SavedAddress>> fetchAddresses() async => saved;
  @override
  Future<List<SavedAddress>> saveAddress(SavedAddress address) async =>
      pendingAddress?.future ?? saved;
  @override
  Future<List<SavedAddress>> removeAddress(String id) async {
    saved = saved.where((a) => a.id != id).toList();
    return saved;
  }

  @override
  Future<List<SavedAddress>> setDefaultAddress(String id) async {
    saved = saved
        .map(
          (a) => SavedAddress.fromJson({
            ...addressJson(a),
            'isDefault': a.id == id,
          }),
        )
        .toList();
    return saved;
  }

  @override
  Future<void> logout() async {
    authToken = null;
    currentUserId = null;
  }

  @override
  Future<dynamic> request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    String? key,
  }) async {
    calls.add('$method $path');
    submitted = body;
    if (path.endsWith('/return') && method == 'POST') {
      return pendingReturn?.future ??
          {
            'ok': true,
            'order': orderData({'return_status': 'requested'}),
          };
    }
    if (path.endsWith('/return')) {
      return {
        'order': orderData({
          'return_status': 'received',
          'refund_status': 'processed',
          'refund_amount': '74.25',
          'refund_id': 'rfnd-1',
        }),
        'events': [],
      };
    }
    if (path.contains('/available-slots')) {
      return {
        'availableSlots': ['10:00 AM', '11:00 AM'],
      };
    }
    if (path.endsWith('/schedule')) {
      return pendingSchedule?.future ??
          {
            'id': 'booking-1',
            'booking_date': body!['bookingDate'],
            'time_slot': body['timeSlot'],
            'status': 'confirmed',
          };
    }
    throw const ApiException('Unexpected test request');
  }
}

Future<AppState> loaded(AccountApi api) async {
  addTearDown(api.client.close);
  final state = AppState(api: api, autoLoad: false);
  await state.signIn(email: 'alice@example.test', password: 'unused');
  await Future<void>.delayed(Duration.zero);
  await state.loadHistory();
  await state.loadAddresses();
  return state;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test(
    'order/refund history retains website precision and return eligibility',
    () async {
      final api = AccountApi()
        ..orders = [
          orderData({
            'refund_status': 'processed',
            'refund_amount': '74.25',
            'return_status': 'received',
          }),
        ];
      final state = await loaded(api);
      addTearDown(state.dispose);
      final order = state.orders.single;
      expect(order.grandTotal, 824.65);
      expect(order.unitPrices.single, 412.325);
      expect(order.aftercare.refundAmount, 74.25);
      expect(order.confirmedRefund, 74.25);
      expect(order.shippingAddress, contains('110001'));
      expect(order.canRequestReturn, isFalse);
      expect(OrderModel.fromJson(orderData()).canRequestReturn, isTrue);
      expect(
        OrderModel.fromJson(
          orderData({
            'payment_method': 'cash_on_delivery',
            'payment_status': 'pending',
          }),
        ).canRequestReturn,
        isTrue,
      );
      for (final update in [
        {'status': 'shipped'},
        {'payment_status': 'pending'},
        {'refund_status': 'pending'},
        {'return_status': 'rejected'},
        {'refund_amount': '0.01'},
        {'payment_reconciliation_error': 'Needs review'},
      ]) {
        expect(
          OrderModel.fromJson(orderData(update)).canRequestReturn,
          isFalse,
          reason: '$update',
        );
      }
      expect(
        () => OrderModel.fromJson(orderData({'refund_amount': 'NaN'})),
        throwsFormatException,
      );
    },
  );

  test(
    'full-order return acknowledgement, duplicate and account boundaries are enforced',
    () async {
      final api = AccountApi();
      final state = await loaded(api);
      addTearDown(state.dispose);
      final order = state.orders.single;
      await expectLater(
        state.requestOrderReturn(
          order,
          returnReasons.first,
          'Broken seal',
          false,
        ),
        throwsA(isA<ApiException>()),
      );
      expect(api.calls, isEmpty);
      api.pendingReturn = Completer<Object?>();
      final request = state.requestOrderReturn(
        order,
        returnReasons.first,
        'Broken seal',
        true,
      );
      await expectLater(
        state.requestOrderReturn(
          order,
          returnReasons.first,
          'Broken seal',
          true,
        ),
        throwsA(isA<ApiException>()),
      );
      expect(api.submitted, {'reason': '${returnReasons.first}: Broken seal'});
      final rejected = expectLater(request, throwsA(isA<ApiException>()));
      await state.logout();
      api.currentUserId = 'customer-b';
      state.isLoggedIn = true;
      api.pendingReturn!.complete({
        'ok': true,
        'order': orderData({'return_status': 'requested'}),
      });
      await rejected;
      expect(state.orders, isEmpty);
      expect(state.requestingReturnId, isNull);
    },
  );

  test(
    'return errors preserve the original status and successful replies update it',
    () async {
      final api = AccountApi();
      final state = await loaded(api);
      addTearDown(state.dispose);
      final order = state.orders.single;
      api.pendingReturn = Completer<Object?>()..complete({'ok': false});
      await expectLater(
        state.requestOrderReturn(
          order,
          returnReasons.first,
          'Broken seal',
          true,
        ),
        throwsA(isA<ApiException>()),
      );
      expect(state.orders.single.aftercare.returnStatus, isNull);
      api.pendingReturn = null;
      await state.requestOrderReturn(
        order,
        returnReasons.first,
        'Broken seal',
        true,
      );
      expect(state.orders.single.aftercare.returnLabel, 'Awaiting review');
      final audit = await state.loadReturnAudit(order.id);
      expect(audit.order.aftercare.refundId, 'rfnd-1');
    },
  );

  test(
    'multiple addresses and selected delivery survive edits and removal safely',
    () async {
      final api = AccountApi();
      final state = await loaded(api);
      addTearDown(state.dispose);
      expect(state.addresses.length, 2);
      expect(state.homeAddress, home.street);
      await state.useSavedAddress(office);
      expect(state.homeAddress, office.street);
      api.saved = [
        home,
        SavedAddress.fromJson({
          ...addressJson(office),
          'street': 'Updated office',
        }),
      ];
      await state.saveAddress(api.saved.last);
      expect(state.homeAddress, 'Updated office');
      await state.removeAddress('office');
      expect(state.homeAddress, home.street);
      await state.removeAddress('home');
      expect(state.homeAddress, isEmpty);
      expect(state.selectedDeliveryAddressId, isNull);
    },
  );

  test('late address changes cannot populate another account', () async {
    final api = AccountApi();
    final state = await loaded(api);
    addTearDown(state.dispose);
    api.pendingAddress = Completer<List<SavedAddress>>();
    final save = state.saveAddress(office);
    final rejected = expectLater(save, throwsA(isA<ApiException>()));
    await state.logout();
    api.currentUserId = 'customer-b';
    state.isLoggedIn = true;
    api.pendingAddress!.complete([office]);
    await rejected;
    expect(state.addresses, isEmpty);
    expect(state.homeAddress, isEmpty);
  });

  test(
    'address API uses the website methods and authoritative list payloads',
    () async {
      final seen = <String>[];
      final client = MockClient((request) async {
        seen.add('${request.method} ${request.url.path}');
        if (request.method == 'PUT' || request.method == 'POST') {
          final body = jsonDecode(request.body) as Map;
          expect(body['pinCode'], '110001');
          expect(body.containsKey('userId'), isFalse);
        }
        return http.Response(
          jsonEncode([addressJson(home), addressJson(office)]),
          200,
        );
      });
      addTearDown(client.close);
      final api = ApiService(client: client)..authToken = 'token';
      expect((await api.fetchAddresses()).length, 2);
      await api.saveAddress(
        SavedAddress(
          fullName: home.fullName,
          mobile: home.mobile,
          street: home.street,
          pinCode: home.pinCode,
          city: home.city,
          region: home.region,
        ),
      );
      await api.saveAddress(home);
      await api.setDefaultAddress('home');
      await api.removeAddress('office');
      expect(seen, [
        'GET /api/account/addresses',
        'POST /api/account/addresses',
        'PUT /api/account/addresses/home',
        'PATCH /api/account/addresses/home/default',
        'DELETE /api/account/addresses/office',
      ]);
    },
  );

  testWidgets('customer account, address book and refund visual review', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    for (final entry in {
      'PlusJakartaSans': 'assets/fonts/PlusJakartaSans.ttf',
      'CormorantGaramond': 'assets/fonts/CormorantGaramond.ttf',
      'MaterialIcons': 'fonts/MaterialIcons-Regular.otf',
    }.entries) {
      await (FontLoader(
        entry.key,
      )..addFont(rootBundle.load(entry.value))).load();
    }
    final state = (await tester.runAsync(() => loaded(AccountApi())))!;
    addTearDown(state.dispose);
    Future<void> capture(Widget screen, String name) async {
      await tester.pumpWidget(
        RepaintBoundary(
          key: const ValueKey('account-capture'),
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: AppTheme.lightTheme,
            home: screen,
          ),
        ),
      );
      await tester.pump();
      await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 30));
      });
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await expectLater(
        find.byKey(const ValueKey('account-capture')),
        matchesGoldenFile('goldens/$name.png'),
      );
    }

    await capture(
      Scaffold(
        body: ProfileScreen(
          state: state,
          onOpenAppointments: () {},
          onOpenOrders: () {},
          onOpenLogin: () {},
        ),
      ),
      'customer-account',
    );
    await capture(AddressBookScreen(state: state), 'customer-address-book');
    final refund = OrderModel.fromJson(
      orderData({
        'return_status': 'received',
        'refund_status': 'processed',
        'refund_amount': '74.25',
        'refund_id': 'rfnd-1',
        'refunded_at': '2026-10-15T10:00:00Z',
      }),
    );
    await capture(
      Scaffold(
        appBar: AppBar(title: const Text('Return & refund')),
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: OrderAftercarePanel(order: refund),
        ),
      ),
      'customer-refund',
    );
  });

  testWidgets('customers choose among multiple delivery addresses', (
    tester,
  ) async {
    final state = (await tester.runAsync(() => loaded(AccountApi())))!;
    addTearDown(state.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.lightTheme,
        home: AddressBookScreen(state: state),
      ),
    );
    await tester.pump();
    await tester.runAsync(() async {
      await Future<void>.delayed(const Duration(milliseconds: 20));
    });
    await tester.pumpAndSettle();
    expect(find.text('Alice Office'), findsOneWidget);
    final useOffice = find
        .widgetWithText(FilledButton, 'Use for delivery')
        .last;
    await tester.ensureVisible(useOffice);
    await tester.pumpAndSettle();
    await tester.tap(useOffice);
    await tester.pumpAndSettle();
    expect(state.deliveryName, 'Alice Office');
    expect(state.homeAddress, office.street);
    expect(tester.takeException(), isNull);
  });

  testWidgets('rescheduling updates only after server confirmation', (
    tester,
  ) async {
    final api = AccountApi()..pendingSchedule = Completer<Object?>();
    final state = (await tester.runAsync(() => loaded(api)))!;
    addTearDown(state.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.lightTheme,
        home: AppointmentsScreen(state: state, onBookNew: () {}),
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Reschedule appointment'));
    await tester.tap(find.text('Reschedule appointment'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('11:00 AM'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Confirm new appointment time'));
    await tester.tap(find.text('Confirm new appointment time'));
    await tester.pump();
    expect(state.bookings.single.timeSlot, '10:00 AM');
    expect(api.submitted, {
      'bookingDate': '2099-10-20',
      'timeSlot': '11:00 AM',
      'expectedDate': '2099-10-20',
      'expectedTimeSlot': '10:00 AM',
    });
    api.pendingSchedule!.complete({
      'id': 'booking-1',
      'booking_date': '2099-10-20',
      'time_slot': '11:00 AM',
      'status': 'confirmed',
    });
    await tester.pumpAndSettle();
    expect(state.bookings.single.timeSlot, '11:00 AM');
    expect(state.bookings.single.totalAmount, 499);
    expect(tester.takeException(), isNull);
  });

  testWidgets('uncollected COD returns never promise a refund', (tester) async {
    final order = OrderModel.fromJson(
      orderData({
        'payment_method': 'Cash on Delivery',
        'payment_status': 'pending',
        'return_status': 'received',
      }),
    );
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
          body: SingleChildScrollView(child: OrderAftercarePanel(order: order)),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('No refund is due'), findsOneWidget);
    expect(find.text('Closed'), findsOneWidget);
    expect(find.textContaining('Refund completed:'), findsNothing);
  });
}
