import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/models/order_model.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/core/widgets/premium_scaffold.dart';
import 'package:urban_blade_mobile/features/bookings/book_flow_screen.dart';
import 'package:urban_blade_mobile/features/appointments/appointments_screen.dart';
import 'package:urban_blade_mobile/features/checkout/checkout_screen.dart';
import 'package:urban_blade_mobile/features/profile/profile_screen.dart';
import 'package:urban_blade_mobile/features/main_shell.dart';
import 'visual_preview_test.dart' show PreviewApi;
import 'checkout_gateway_test.dart' show FakeGateway;

// Fixtures exist only in tests. No customer account, booking or charge is made.
class FlowPreviewApi extends PreviewApi {
  int bookings = 0;
  @override
  Future<List<String>> fetchAvailableSlots(
          String stylistId, String date) async =>
      ['10:00 AM', '11:30 AM', '02:00 PM', '04:30 PM'];
  @override
  Future<Map<String, dynamic>?> createBooking(
      {required String customerName,
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
      String? serviceAddress}) async {
    bookings++;
    return {'id': 'UB-APPOINTMENT-PREVIEW'};
  }
}

class FlowPreviewState extends AppState {
  FlowPreviewState(FlowPreviewApi api) : super(api: api, autoLoad: false);
  int submittedOrders = 0;
  @override
  Future<void> syncCart() async {}
  @override
  Future<Map<String, dynamic>?> getAuthoritativeQuote() async => {
        'subtotal': 449,
        'shippingFee': 49,
        'discountAmount': 0,
        'taxInclusive': true,
        'totalAmount': 498
      };
  @override
  Future<OrderModel> placeCodOrder() async {
    submittedOrders++;
    return OrderModel(
        id: 'UB-ORDER-PREVIEW',
        items: cart,
        subtotal: 449,
        deliveryFee: 49,
        grandTotal: 498,
        shippingAddress: homeAddress,
        paymentMethod: 'Cash on delivery',
        orderDate: DateTime(2026, 10, 8),
        estimatedDelivery: '');
  }
}

void main() {
  testWidgets('booking, checkout and account surfaces remain connected',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    debugDisableShadows = false;
    addTearDown(() => debugDisableShadows = true);
    await (FontLoader('PlusJakartaSans')
          ..addFont(rootBundle.load('assets/fonts/PlusJakartaSans.ttf')))
        .load();
    await (FontLoader('CormorantGaramond')
          ..addFont(rootBundle.load('assets/fonts/CormorantGaramond.ttf')))
        .load();
    await (FontLoader('MaterialIcons')
          ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf')))
        .load();
    final api = FlowPreviewApi();
    final state = FlowPreviewState(api);
    await state.loadRemoteData();
    state.isLoggedIn = true;
    state.userName = 'Arjun';
    state.userEmail = 'preview@example.com';
    state.userPhone = '9876543210';
    await state.saveDelivery(
        name: 'Arjun',
        phone: '9876543210',
        street: '24 Studio Road',
        newCity: 'Ghaziabad',
        newRegion: 'Uttar Pradesh',
        pin: '201009');
    final captureKey = GlobalKey();
    Future<void> host(Widget screen, String key) async {
      await tester.pumpWidget(RepaintBoundary(
          key: captureKey,
          child: MaterialApp(
              key: ValueKey(key),
              debugShowCheckedModeBanner: false,
              theme: AppTheme.lightTheme,
              home: screen)));
      await tester.pumpAndSettle();
    }

    Future<void> preview(String name) async {
      await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 180)));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      if (const bool.fromEnvironment('WRITE_UI_PREVIEWS')) {
        final boundary = captureKey.currentContext!.findRenderObject()!
            as RenderRepaintBoundary;
        await tester.runAsync(() async {
          final img = await boundary.toImage();
          final data = await img.toByteData(format: ui.ImageByteFormat.png);
          final file = File('design/implemented/$name.png');
          await file.parent.create(recursive: true);
          await file.writeAsBytes(data!.buffer.asUint8List());
          img.dispose();
        });
      }
    }

    state.toggleServiceSelection('cut');
    await host(
        PremiumScaffold(
            appBar: AppBar(title: const Text('Book an appointment')),
            body: BookFlowScreen(state: state, onBookingComplete: () {})),
        'booking');
    await preview('booking-select');
    await tester.tap(find.text('Choose date & time'));
    await tester.pumpAndSettle();
    await preview('booking-schedule');
    await tester.tap(find.text('10:00 AM'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Review appointment'));
    await tester.pumpAndSettle();
    await preview('booking-review');
    expect(api.bookings, 0);
    await tester.tap(find.text('Confirm appointment'));
    await tester.pumpAndSettle();
    expect(api.bookings, 1);
    expect(find.text('See you soon.'), findsOneWidget);
    await preview('booking-confirmed');
    await host(
        AppointmentsScreen(state: state, onBookNew: () {}), 'appointments');
    await preview('appointments');
    state.addToCart(state.products.first);
    await host(
        CheckoutScreen(
            state: state, gateway: FakeGateway(), onOrderPlaced: () {}),
        'checkout');
    await preview('checkout');
    await tester.tap(find.text('Cash on delivery'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Place order · ₹498.00'), 200);
    await tester.tap(find.text('Place order · ₹498.00'));
    await tester.pumpAndSettle();
    expect(state.submittedOrders, 1);
    expect(find.text('You’re all set.'), findsOneWidget);
    await preview('order-confirmed');
    state.toggleWishlist('oil');
    await host(
        PremiumScaffold(
            appBar: AppBar(title: const Text('My profile')),
            body: ProfileScreen(
                state: state,
                onOpenAppointments: () {},
                onOpenOrders: () {},
                onOpenLogin: () {})),
        'profile');
    await preview('account');
    await tester.scrollUntilVisible(find.text('Saved items'), 200);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Saved items'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Saved items'));
    await tester.pumpAndSettle();
    expect(find.text('Saved for later'), findsOneWidget);
    await preview('saved-items');
    Navigator.of(tester.element(find.text('Saved for later'))).pop();
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Address book'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Address book'));
    await tester.pumpAndSettle();
    await preview('delivery-address');
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
    debugDisableShadows = true;
  });
  testWidgets('featured home cards preselect both booking locations',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final state = AppState(api: PreviewApi(), autoLoad: false);
    await state.loadRemoteData();
    await tester.pumpWidget(
        MaterialApp(theme: AppTheme.lightTheme, home: MainShell(state: state)));
    await tester.pumpAndSettle();
    for (final mode in ['home', 'studio']) {
      await tester.ensureVisible(find.byKey(ValueKey('home-card-$mode')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(ValueKey('home-card-$mode')));
      await tester.pumpAndSettle();
      expect(state.locationMode, mode);
      expect(find.text('Where would you like your service?'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(const ValueKey('tab-0')));
      await tester.pumpAndSettle();
    }
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });
  testWidgets('home category opens the matching catalog and shared image route',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    final state = AppState(api: PreviewApi(), autoLoad: false);
    await state.loadRemoteData();
    await tester.pumpWidget(
        MaterialApp(theme: AppTheme.lightTheme, home: MainShell(state: state)));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
        find.byKey(const ValueKey('home-category-hair')), 260,
        scrollable: find.byType(Scrollable).first);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('home-category-hair')));
    await tester.pumpAndSettle();
    expect(find.text('1 essentials'), findsOneWidget);
    await tester.ensureVisible(find.text('Daily Care Shampoo'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Daily Care Shampoo'));
    await tester.pumpAndSettle();
    expect(find.text('Product details'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Add to bag'));
    await tester.pumpAndSettle();
    expect(state.cartCount, 1);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });
}
