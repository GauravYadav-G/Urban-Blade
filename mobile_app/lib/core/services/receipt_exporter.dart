import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'receipt_document.dart';

/// PDF layout is shared by the app and visual regression fixtures.
class ReceiptExporter {
  static const channel = MethodChannel('com.urbanblade.mobile/receipts');

  static Future<Uint8List> buildBytes(Map<dynamic, dynamic> order) async {
    final font = await rootBundle.load('assets/fonts/PlusJakartaSans.ttf');
    return compute(
        buildReceiptDocument,
        ReceiptDocumentInput(
            order.map((key, value) => MapEntry(key.toString(), value)),
            font.buffer.asUint8List(font.offsetInBytes, font.lengthInBytes)));
  }

  static Future<bool> save(Map<dynamic, dynamic> order) async {
    final id =
        '${order['id'] ?? 'order'}'.replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '_');
    final bytes = await buildBytes(order);
    return await channel.invokeMethod<bool>('savePdf', {
          'filename': 'UrbanBlade-receipt-$id.pdf',
          'bytes': bytes,
        }) ??
        false;
  }
}
