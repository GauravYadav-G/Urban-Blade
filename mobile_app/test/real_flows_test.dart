import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/services/api_service.dart';
import 'package:urban_blade_mobile/core/models/product_model.dart';

class FailingApi extends ApiService {
  @override
  Future<Map<String, dynamic>?> quoteOrder(
          {required List<Map<String, dynamic>> items,
          String? couponCode}) async =>
      null;
  @override
  Future<Map<String, dynamic>?> verifyRazorpayPayment(
          {required String orderId,
          required String razorpayOrderId,
          required String razorpayPaymentId,
          required String razorpaySignature}) async =>
      null;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));
  const product = ProductModel(
      id: 'real-product',
      name: 'Shampoo',
      price: 300,
      imageUrl: '',
      category: 'hair',
      description: '');
  test('New installs browse as guests without fabricated activity', () {
    final state = AppState(autoLoad: false);
    expect(state.isLoggedIn, false);
    expect(state.cart, isEmpty);
    expect(state.orders, isEmpty);
    expect(state.bookings, isEmpty);
    expect(state.products, isEmpty);
    state.dispose();
  });
  test('Failed quote preserves cart and cannot create a COD confirmation',
      () async {
    final state = AppState(api: FailingApi(), autoLoad: false)
      ..addToCart(product);
    await expectLater(state.placeCodOrder(), throwsException);
    expect(state.orders, isEmpty);
    expect(state.cartCount, 1);
    state.dispose();
  });
  test('Failed gateway verification cannot create a paid order or empty cart',
      () async {
    final state = AppState(api: FailingApi(), autoLoad: false)
      ..addToCart(product);
    await expectLater(
        state.finalizeRazorpayOrder(
            orderId: 'order',
            razorpayOrderId: 'rzp',
            razorpayPaymentId: 'payment',
            razorpaySignature: 'invalid',
            amountInPaise: 30000),
        throwsException);
    expect(state.orders, isEmpty);
    expect(state.cartCount, 1);
    state.dispose();
  });
  test('Guest booking cannot produce a local confirmation', () async {
    final state = AppState(autoLoad: false);
    await expectLater(state.createBooking(), throwsException);
    expect(state.bookings, isEmpty);
    state.dispose();
  });
}
