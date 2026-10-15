import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/models/booking_model.dart';
import 'package:urban_blade_mobile/core/models/order_model.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/features/appointments/appointments_screen.dart';
import 'package:urban_blade_mobile/features/bookings/book_flow_screen.dart';
import 'package:urban_blade_mobile/features/cart/cart_screen.dart';
import 'package:urban_blade_mobile/features/cart/cart_sheet_host.dart';
import 'package:urban_blade_mobile/features/checkout/checkout_screen.dart';
import 'package:urban_blade_mobile/features/home/home_screen.dart';
import 'package:urban_blade_mobile/features/orders/orders_screen.dart';
import 'package:urban_blade_mobile/features/profile/profile_screen.dart';
import 'package:urban_blade_mobile/features/services/services_screen.dart';
import 'checkout_gateway_test.dart' show FakeGateway;
import 'full_flow_preview_test.dart' show FlowPreviewApi, FlowPreviewState;

class _DelayedBookingApi extends FlowPreviewApi {
  final result = Completer<Map<String, dynamic>?>();
  @override
  Future<Map<String, dynamic>?> createBooking({
    required String customerName,
    required String customerEmail,
    required String customerPhone,
    String? stylistId,
    String? serviceId,
    required String serviceName,
    required String date,
    required String timeSlot,
    required int totalPrice,
    String? notes,
    String visitType = 'salon',
    String? serviceAddress,
  }) {
    bookings++;
    return result.future;
  }
}

class _DelayedPaymentState extends FlowPreviewState {
  final result = Completer<Map<String, dynamic>>();
  int attempts = 0;
  _DelayedPaymentState() : super(FlowPreviewApi()) {
    postalCode = '201009';
    deliveryPhone = '9876543210';
  }
  @override
  String get homeAddress => '24 Studio Road';
  @override
  Future<Map<String, dynamic>?> createRazorpayOrder() async {
    attempts++;
    pendingPayment = await result.future;
    await persistDraft();
    return pendingPayment;
  }
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  Future<FlowPreviewState> createState({FlowPreviewApi? api}) async {
    final state = FlowPreviewState(api ?? FlowPreviewApi());
    await state.loadRemoteData();
    state.userName = 'Customer with a long full name';
    state.userEmail = 'customer.with.a.long.address@example.test';
    state.userPhone = '9876543210';
    state.toggleServiceSelection('cut');
    state.addToCart(state.products.first);
    state.bookings.add(BookingModel(
      id: 'UB-APPOINTMENT-2026-1234567890',
      service: state.services.first,
      barber: state.barbers.first,
      locationType: 'studio',
      studioOrHomeAddress: '24 Studio Road, Ghaziabad, Uttar Pradesh',
      date: '2026-10-20',
      timeSlot: '10:00 AM',
      totalAmount: 249,
      createdAt: DateTime(2026, 10, 14),
    ));
    state.orders.add(OrderModel(
      id: 'UB-ORDER-2026-1234567890',
      items: List.of(state.cart),
      subtotal: 449,
      deliveryFee: 49,
      grandTotal: 498,
      shippingAddress: '24 Studio Road, Ghaziabad, Uttar Pradesh',
      paymentMethod: 'Cash on delivery',
      orderDate: DateTime(2026, 10, 14),
      estimatedDelivery: '',
    ));
    return state;
  }

  void configureView(WidgetTester tester, Size size) {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }

  Future<void> host(WidgetTester tester, Widget screen,
      {double scale = 2}) async {
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.lightTheme,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(scale),
          disableAnimations: true,
        ),
        child: child!,
      ),
      home: screen,
    ));
    await tester.pumpAndSettle();
  }

  for (final size in [const Size(320, 568), const Size(568, 320)]) {
    for (final name in [
      'home',
      'services',
      'cart',
      'profile',
      'appointments',
      'orders',
      'checkout'
    ]) {
      testWidgets('$name fits ${size.width}x${size.height} with enlarged text',
          (tester) async {
        configureView(tester, size);
        final state = await createState();
        final Widget screen;
        switch (name) {
          case 'home':
            screen = Scaffold(
                body: HomeScreen(
                    state: state,
                    onNavigateToServices: () {},
                    onNavigateToBook: () {},
                    onNavigateToShop: () {},
                    onSelectProduct: (_) {}));
          case 'services':
            screen = Scaffold(
                body: ServicesScreen(state: state, onProceedToBooking: () {}));
          case 'cart':
            screen = Scaffold(
                body: CartScreen(
                    state: state,
                    onProceedToCheckout: () {},
                    onContinueShopping: () {}));
          case 'profile':
            screen = Scaffold(
                body: ProfileScreen(
                    state: state,
                    onOpenAppointments: () {},
                    onOpenOrders: () {},
                    onOpenLogin: () {}));
          case 'appointments':
            screen = AppointmentsScreen(state: state, onBookNew: () {});
          case 'orders':
            screen = OrdersScreen(state: state, onShopNew: () {});
          default:
            screen = CheckoutScreen(
                state: state, gateway: FakeGateway(), onOrderPlaced: () {});
        }
        await host(tester, screen);
        expect(tester.takeException(), isNull);
        final scrollable = find.byType(Scrollable).first;
        for (var i = 0; i < 8; i++) {
          await tester.drag(scrollable, const Offset(0, -250));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
        }
        await state.persistDraft();
        await tester.pumpWidget(const SizedBox());
        state.dispose();
      });
    }
  }

  for (final size in [const Size(320, 568), const Size(568, 320)]) {
    testWidgets(
        'booking dates and review stay usable at $size with enlarged text',
        (tester) async {
      configureView(tester, size);
      final state = await createState();
      state.barbers.clear();
      await host(
          tester,
          Scaffold(
              body: AnimatedBuilder(
                  animation: state,
                  builder: (_, __) =>
                      BookFlowScreen(state: state, onBookingComplete: () {}))));
      await tester.tap(find.text('Choose date & time'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.scrollUntilVisible(find.text('10:00 AM'), 120,
          scrollable: find.byType(Scrollable).first);
      await tester.tap(find.text('10:00 AM'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Review appointment'));
      await tester.pumpAndSettle();
      expect(find.text('Everything look right?'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await state.persistDraft();
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    });
  }

  testWidgets('cart sheet fits a landscape keyboard without trapping controls',
      (tester) async {
    configureView(tester, const Size(568, 320));
    addTearDown(tester.view.resetViewInsets);
    final state = await createState();
    final key = GlobalKey<CartSheetHostState>();
    await host(
        tester,
        Scaffold(
            body: CartSheetHost(
                key: key,
                state: state,
                onCheckout: () {},
                child: const SizedBox.expand())));
    key.currentState!.open();
    await tester.pumpAndSettle();
    tester.view.viewInsets = const FakeViewPadding(bottom: 220);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.byTooltip('Close cart').hitTestable(), findsOneWidget);
    await tester.tap(find.byTooltip('Close cart'));
    await tester.pumpAndSettle();
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });

  testWidgets('empty appointments remain reachable in landscape',
      (tester) async {
    configureView(tester, const Size(568, 320));
    final state = await createState();
    state.bookings.clear();
    await host(tester, AppointmentsScreen(state: state, onBookNew: () {}));
    expect(tester.takeException(), isNull);
    await tester.ensureVisible(find.text('Book an Appointment'));
    await tester.pumpAndSettle();
    expect(find.text('Book an Appointment').hitTestable(), findsOneWidget);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });

  for (final size in [const Size(320, 568), const Size(568, 320)]) {
    testWidgets('profile editor save stays reachable with a keyboard at $size',
        (tester) async {
      configureView(tester, size);
      addTearDown(tester.view.resetViewInsets);
      final state = await createState();
      state.isLoggedIn = true;
      await host(
          tester,
          Scaffold(
              body: ProfileScreen(
                  state: state,
                  onOpenAppointments: () {},
                  onOpenOrders: () {},
                  onOpenLogin: () {})));
      await tester.scrollUntilVisible(find.text('Edit profile'), 120,
          scrollable: find.byType(Scrollable).first);
      await tester.pumpAndSettle();
      expect(find.text('Edit profile').hitTestable(), findsOneWidget);
      await tester.tap(find.text('Edit profile'));
      await tester.pumpAndSettle();
      tester.view.viewInsets =
          FakeViewPadding(bottom: size.height < 400 ? 220 : 260);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Save changes'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Save changes').hitTestable(), findsOneWidget);
      await state.persistDraft();
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    });
  }

  testWidgets('leaving a pending booking handles a late failure safely',
      (tester) async {
    configureView(tester, const Size(390, 844));
    final api = _DelayedBookingApi();
    final state = await createState(api: api);
    state.isLoggedIn = true;
    await host(
        tester,
        Scaffold(
            body: AnimatedBuilder(
                animation: state,
                builder: (_, __) =>
                    BookFlowScreen(state: state, onBookingComplete: () {}))),
        scale: 1);
    await tester.tap(find.text('Choose date & time'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('10:00 AM'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Review appointment'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Confirm appointment'));
    await tester.pump();
    expect(api.bookings, 1);
    expect(find.text('Confirming…'), findsOneWidget);
    final button = tester.widget<FilledButton>(find.ancestor(
        of: find.text('Confirming…'), matching: find.byType(FilledButton)));
    expect(button.onPressed, isNull);
    await tester.pumpWidget(const SizedBox());
    api.result
        .completeError(Exception('The selected time is no longer available.'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(api.bookings, 1);
    await state.persistDraft();
    state.dispose();
  });

  testWidgets(
      'leaving checkout preserves a late order without opening its disposed gateway',
      (tester) async {
    final state = _DelayedPaymentState();
    final gateway = FakeGateway();
    await host(tester,
        CheckoutScreen(state: state, gateway: gateway, onOrderPlaced: () {}),
        scale: 1);
    await tester.tap(find.text('Pay · ₹498.00'));
    await tester.pump();
    expect(state.attempts, 1);
    await tester.pumpWidget(const SizedBox());
    expect(gateway.disposed, isTrue);
    state.result.complete({
      'orderId': 'saved-order',
      'razorpayOrderId': 'gateway-order',
      'keyId': 'rzp_test_example',
      'amount': 49800,
      'currency': 'INR',
      'totalAmount': 498,
    });
    await tester.pumpAndSettle();
    expect(gateway.options, isNull);
    expect(state.pendingPayment?['orderId'], 'saved-order');
    expect(tester.takeException(), isNull);
    await state.persistDraft();
    state.dispose();
  });
}
