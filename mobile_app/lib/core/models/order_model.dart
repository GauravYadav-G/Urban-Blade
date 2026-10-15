import 'dart:convert';
import 'product_model.dart';
import 'order_return_model.dart';

enum OrderStatus {
  placed,
  confirmed,
  dispatched,
  outForDelivery,
  delivered,
  cancelled,
}

class OrderModel {
  final String id;
  final String currency;
  final OrderAftercare aftercare;
  final List<num> unitPrices;
  final String serverStatus;
  final List<CartItem> items;
  final num subtotal;
  final num deliveryFee;
  final num discount;
  final num grandTotal;
  final String shippingAddress;
  final String paymentMethod;
  final String paymentStatus;
  final String transactionId;
  final String trackingNumber;
  final OrderStatus status;
  final DateTime orderDate;
  final String estimatedDelivery;

  const OrderModel({
    required this.id,
    this.currency = 'INR',
    this.aftercare = const OrderAftercare(),
    this.unitPrices = const [],
    this.serverStatus = '',
    required this.items,
    required this.subtotal,
    this.deliveryFee = 0,
    this.discount = 0,
    required this.grandTotal,
    required this.shippingAddress,
    required this.paymentMethod,
    this.paymentStatus = 'pending',
    this.transactionId = '',
    this.trackingNumber = '',
    this.status = OrderStatus.confirmed,
    required this.orderDate,
    required this.estimatedDelivery,
  });

  bool get uncollectedCod =>
      [
        'cash on delivery',
        'cash_on_delivery',
      ].contains(paymentMethod.toLowerCase().trim()) &&
      paymentStatus.toLowerCase().trim() == 'pending';
  bool get canRequestReturn =>
      status == OrderStatus.delivered &&
      aftercare.returnStatus == null &&
      aftercare.refundStatus == null &&
      aftercare.paymentReview == null &&
      (aftercare.refundAmount ?? 0) <= 0 &&
      (['paid', 'captured'].contains(paymentStatus.toLowerCase().trim()) ||
          uncollectedCod);
  num get confirmedRefund =>
      aftercare.confirmedRefundAmount ??
      (aftercare.refundStatus == 'processed' || paymentStatus == 'refunded'
          ? aftercare.refundAmount ??
                (paymentStatus == 'refunded' ? grandTotal : 0)
          : 0);

  factory OrderModel.fromJson(Map<String, dynamic> row) {
    num amount(Object? value, {num fallback = 0}) {
      if (value == null) return fallback;
      final parsed = num.tryParse('$value');
      if (parsed == null || !parsed.isFinite || parsed < 0) {
        throw const FormatException(
          'The order amount could not be read. Please refresh.',
        );
      }
      return parsed;
    }

    if (row['id'] == null ||
        row['items'] is! List ||
        row['total_amount'] == null) {
      throw const FormatException(
        'The order could not be read. Please refresh.',
      );
    }
    final date = DateTime.tryParse('${row['created_at']}');
    if (date == null) {
      throw const FormatException('The order date could not be read.');
    }
    Object? address = row['shipping_address'];
    if (address is String) {
      try {
        address = jsonDecode(address);
      } catch (_) {
        address = null;
      }
    }
    final fields = address is Map ? address : const {};
    final prices = <num>[];
    final items = <CartItem>[];
    for (final value in row['items'] as List) {
      if (value is! Map) {
        throw const FormatException('The order items could not be read.');
      }
      final quantity = amount(value['quantity']);
      if (quantity < 1 || quantity != quantity.truncateToDouble()) {
        throw const FormatException('The order quantity could not be read.');
      }
      final price = amount(value['unit_price']);
      prices.add(price);
      items.add(
        CartItem(
          quantity: quantity.toInt(),
          product: ProductModel.fromJson({
            'id': value['product_id'],
            'name': value['product_name'],
            'price': price,
            'imageUrl': value['image_url'],
          }),
        ),
      );
    }
    final status = '${row['status']}'.toLowerCase();
    return OrderModel(
      id: '${row['id']}',
      items: List.unmodifiable(items),
      unitPrices: List.unmodifiable(prices),
      subtotal: amount(row['subtotal'], fallback: amount(row['total_amount'])),
      deliveryFee: amount(row['shipping_fee']),
      discount: amount(row['discount_amount']),
      grandTotal: amount(row['total_amount']),
      currency: row['currency'] is String ? row['currency'] : 'INR',
      shippingAddress: [
        fields['street'],
        fields['city'],
        fields['state'],
        fields['postalCode'] ?? fields['pinCode'],
      ].where((v) => v != null && '$v'.isNotEmpty).join(', '),
      paymentMethod: row['payment_method']?.toString() ?? '',
      paymentStatus: row['payment_status']?.toString() ?? 'pending',
      transactionId: row['transaction_id']?.toString() ?? '',
      trackingNumber: row['tracking_number']?.toString() ?? '',
      aftercare: OrderAftercare.fromJson(row),
      serverStatus: status,
      status: switch (status.replaceAll('_', '')) {
        'accepted' || 'confirmed' || 'processing' => OrderStatus.confirmed,
        'shipped' || 'dispatched' => OrderStatus.dispatched,
        'outfordelivery' => OrderStatus.outForDelivery,
        'delivered' => OrderStatus.delivered,
        'cancelled' => OrderStatus.cancelled,
        _ => OrderStatus.placed,
      },
      orderDate: date,
      estimatedDelivery: 'See order status for updates',
    );
  }

  String get statusDisplay {
    if (serverStatus == 'processing') return 'Processing';
    if (serverStatus == 'shipped') return 'Shipped';
    switch (status) {
      case OrderStatus.placed:
        return 'Placed';
      case OrderStatus.confirmed:
        return 'Confirmed';
      case OrderStatus.dispatched:
        return 'Dispatched';
      case OrderStatus.outForDelivery:
        return 'Out for Delivery';
      case OrderStatus.delivered:
        return 'Delivered';
      case OrderStatus.cancelled:
        return 'Cancelled';
    }
  }

  int get statusStep {
    switch (status) {
      case OrderStatus.placed:
        return -1;
      case OrderStatus.confirmed:
        return 0;
      case OrderStatus.dispatched:
        return 1;
      case OrderStatus.outForDelivery:
        return 2;
      case OrderStatus.delivered:
        return 3;
      case OrderStatus.cancelled:
        return -1;
    }
  }
}

class ReturnAudit {
  final OrderModel order;
  final List<ReturnEvent> events;
  const ReturnAudit(this.order, this.events);
}
