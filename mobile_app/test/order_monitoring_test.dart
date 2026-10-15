import 'package:flutter_test/flutter_test.dart';
import 'package:urban_blade_mobile/core/models/order_model.dart';
import 'package:urban_blade_mobile/core/services/api_service.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';

class HistoryApi extends ApiService {
  @override
  Future<List<dynamic>> fetchHistory(String resource) async => resource == 'orders' ? [{
    'id': 'order-1', 'items': [], 'total_amount': 500,
    'payment_method': 'Cash on Delivery', 'payment_status': 'pending',
    'tracking_number': 'TRACK-1', 'status': 'dispatched',
    'shipping_address': {'street': '12 Main Road', 'city': 'Pune'},
    'created_at': '2026-10-06T10:00:00Z',
  }] : [{
    'id': 'booking-1', 'notes': 'Haircut. Location: home. Address: 12 Main Road, Pune',
    'booking_date': '2026-10-07', 'time_slot': '10:00 AM',
    'status': 'in_progress', 'created_at': '2026-10-06T10:00:00Z',
  }];
}

void main() {
  test('tracking highlights only the actual completed milestones', () {
    final expected = [-1, 0, 1, 2, 3, -1];
    for (var i = 0; i < OrderStatus.values.length; i++) {
      final order = OrderModel(id: '1', items: [], subtotal: 0, grandTotal: 0,
        shippingAddress: '', paymentMethod: 'Cash on Delivery',
        status: OrderStatus.values[i], orderDate: DateTime(2026), estimatedDelivery: '');
      expect(order.statusStep, expected[i]);
      expect(order.paymentStatus, 'pending');
    }
  });
  test('history preserves unpaid status, tracking and home appointment address', () async {
    final state = AppState(api: HistoryApi(), autoLoad: false)..isLoggedIn = true;
    await state.loadHistory();
    expect(state.historyError, isNull);
    expect(state.orders.single.paymentStatus, 'pending');
    expect(state.orders.single.trackingNumber, 'TRACK-1');
    expect(state.orders.single.shippingAddress, '12 Main Road, Pune');
    expect(state.bookings.single.locationType, 'home');
    expect(state.bookings.single.studioOrHomeAddress, '12 Main Road, Pune');
    expect(state.bookings.single.statusDisplay, 'In Progress');
    state.dispose();
  });
}
