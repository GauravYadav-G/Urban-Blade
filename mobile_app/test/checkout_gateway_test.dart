import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/services/payment_gateway.dart';
import 'package:urban_blade_mobile/core/models/order_model.dart';
import 'package:urban_blade_mobile/features/checkout/checkout_screen.dart';

class PendingState extends AppState {
  PendingState() : super(autoLoad: false) {
    pendingPayment = {
      'orderId': 'internal',
      'razorpayOrderId': 'order_remote',
      'keyId': 'rzp_test_example',
      'amount': 44900,
      'currency': 'INR',
      'totalAmount': 449
    };
  }
  int reconciliations = 0;
  @override
  Future<OrderModel?> checkPendingPayment() async {
    reconciliations++;
    return null;
  }
}

class FakeGateway implements PaymentGateway {
  Map<String, dynamic>? options;
  bool disposed = false;
  @override
  Future<PaymentResult> open(Map<String, dynamic> options) async {
    this.options = options;
    return const PaymentResult(
        error: 'Payment failed. Try a different method.');
  }

  @override
  void dispose() {
    disposed = true;
  }
}

class DeferredGateway extends FakeGateway {
  final completion = Completer<PaymentResult>();
  int opens = 0;
  @override
  Future<PaymentResult> open(Map<String, dynamic> options) {
    opens++;
    this.options = options;
    return completion.future;
  }
}

class UpiState extends PendingState {
  @override
  String get homeAddress => '12 Test Street';
  UpiState() {
    pendingPayment = null;
    postalCode = '400001';
    deliveryPhone = '9999999999';
    userEmail = 'customer@example.test';
  }
  @override
  Future<Map<String, dynamic>?> getAuthoritativeQuote() async => {
        'totalAmount': 449,
        'subtotal': 449,
        'shippingFee': 0,
        'discountAmount': 0,
      };
  @override
  Future<Map<String, dynamic>?> createRazorpayOrder() async {
    pendingPayment = {
      'orderId': 'internal',
      'razorpayOrderId': 'order_remote',
      'keyId': 'rzp_live_example',
      'amount': 44900,
      'currency': 'INR',
      'totalAmount': 449,
    };
    return pendingPayment;
  }
}

void main() {
  testWidgets(
      'test-mode UPI explains the limitation and permits standard checkout',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    final state = PendingState();
    final gateway = FakeGateway();
    await tester.pumpWidget(MaterialApp(
        home: CheckoutScreen(
            state: state, gateway: gateway, onOrderPlaced: () {})));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Pay with UPI'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pay with UPI'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Resume secure checkout'));
    await tester.pumpAndSettle();
    expect(gateway.options, isNull);
    expect(find.textContaining('UPI app handoff is not available'),
        findsOneWidget);
    await tester.ensureVisible(find.text('Pay securely online'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pay securely online'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Resume secure checkout'));
    await tester.pumpAndSettle();
    expect(gateway.options!['order_id'], 'order_remote');
    expect(state.pendingPayment, isNotNull);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });

  testWidgets(
      'returning from native checkout checks status without opening a second attempt',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    final state = PendingState();
    final gateway = DeferredGateway();
    await tester.pumpWidget(MaterialApp(
        home: CheckoutScreen(
            state: state, gateway: gateway, onOrderPlaced: () {})));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Resume secure checkout'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    final before = state.reconciliations;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(state.reconciliations, before + 1);
    expect(gateway.opens, 1);
    gateway.completion.complete(const PaymentResult(cancelled: true));
    await tester.pumpAndSettle();
    expect(find.textContaining('Checkout closed.'), findsOneWidget);
    expect(state.pendingPayment, isNotNull);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });

  for (final app
      in {'PhonePe': 'phonepe', 'Google Pay': 'google_pay'}.entries) {
    testWidgets(
        '${app.key} selection passes the existing server order to UPI checkout',
        (tester) async {
      SharedPreferences.setMockInitialValues({});
      final state = UpiState();
      final gateway = FakeGateway();
      await tester.pumpWidget(MaterialApp(
          home: CheckoutScreen(
              state: state, gateway: gateway, onOrderPlaced: () {})));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Pay with UPI'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Pay with UPI'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text(app.key));
      await tester.pumpAndSettle();
      await tester.tap(find.text(app.key));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Pay · ₹449.00'));
      await tester.pumpAndSettle();
      expect(gateway.options!['order_id'], 'order_remote');
      expect(gateway.options!['amount'], 44900);
      expect((gateway.options!['prefill'] as Map)['method'], 'upi');
      final display = (gateway.options!['config'] as Map)['display'] as Map;
      final block = (display['blocks'] as Map)['preferred_upi'] as Map;
      expect(
          ((block['instruments'] as List).single as Map)['apps'], [app.value]);
      expect(state.pendingPayment, isNotNull);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    });
  }

  testWidgets(
      'gateway rejection retains pending order and retries the same server order',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    final state = PendingState();
    final gateway = FakeGateway();
    var completed = false;
    await tester.pumpWidget(MaterialApp(
        home: CheckoutScreen(
            state: state,
            gateway: gateway,
            onOrderPlaced: () {
              completed = true;
            })));
    await tester.pumpAndSettle();
    for (var attempt = 0; attempt < 2; attempt++) {
      final resume = find.text('Resume secure checkout');
      await tester.scrollUntilVisible(resume, 300);
      await tester.tap(resume);
      await tester.pumpAndSettle();
      expect(gateway.options!['order_id'], 'order_remote');
      expect(gateway.options!['amount'], 44900);
      expect(
          find.text('Payment failed. Try a different method.'), findsOneWidget);
      expect(state.pendingPayment!['orderId'], 'internal');
      expect(completed, false);
      expect(tester.takeException(), isNull);
    }
    expect(state.reconciliations, 5);
    await tester.pumpWidget(const SizedBox());
    expect(gateway.disposed, true);
    state.dispose();
  });
}
