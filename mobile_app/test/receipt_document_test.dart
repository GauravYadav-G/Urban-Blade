import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:urban_blade_mobile/core/services/receipt_exporter.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('styled receipts render short paid and multipage pending orders',
      () async {
    final directory = Directory('/tmp/urbanblade-validation/receipts')
      ..createSync(recursive: true);
    final base = <String, dynamic>{
      'id': 'UB-2026-1042',
      'created_at': '2026-10-09T10:30:00Z',
      'payment_status': 'paid',
      'payment_method': 'Razorpay / UPI',
      'transaction_id': 'pay_urbanblade_example_1042',
      'subtotal': 1247,
      'shipping_fee': 49,
      'discount_amount': 100,
      'total_amount': 1196,
      'shipping_address': {
        'fullName': 'Aarav Sharma',
        'street': 'Flat 12B, Magnolia Residency, Pratap Vihar',
        'city': 'Ghaziabad',
        'state': 'Uttar Pradesh',
        'postalCode': '201009',
        'phone': '+91 90000 00000'
      },
      'items': [
        {
          'quantity': 2,
          'product_name': 'Sandalwood Beard Oil - 30 ml',
          'unit_price': 449
        },
        {
          'quantity': 1,
          'product_name': 'Daily Care Shampoo - 250 ml',
          'unit_price': 349
        },
      ],
    };
    for (final long in [false, true]) {
      final order = {...base};
      if (long) {
        order['payment_status'] = 'pending';
        order['payment_method'] = 'Cash on delivery';
        order.remove('transaction_id');
        order['items'] = List.generate(
            65,
            (i) => {
                  'quantity': 1,
                  'product_name':
                      'Grooming essential ${i + 1} - daily care collection with a longer product description',
                  'unit_price': 100
                });
        order['subtotal'] = 6500;
        order['total_amount'] = 6449;
      }
      final bytes = await ReceiptExporter.buildBytes(order);
      expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
      expect(bytes.length, greaterThan(1000));
      await File(
              '${directory.path}/${long ? 'pending-multipage' : 'paid-receipt'}.pdf')
          .writeAsBytes(bytes);
    }
  });
}
