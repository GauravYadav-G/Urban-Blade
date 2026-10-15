import 'dart:typed_data';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

class ReceiptDocumentInput {
  final Map<String, dynamic> order;
  final Uint8List font;
  const ReceiptDocumentInput(this.order, this.font);
}

/// Pure PDF layout; run in an isolate so long receipts do not block animation.
Future<Uint8List> buildReceiptDocument(ReceiptDocumentInput input) async {
  final order = input.order;
  const ink = PdfColor.fromInt(0xFF0B0F19);
  const amber = PdfColor.fromInt(0xFFF59E0B);
  const slate = PdfColor.fromInt(0xFF64748B);
  const paper = PdfColor.fromInt(0xFFF3F5F7);
  const line = PdfColor.fromInt(0xFFE2E8F0);
  final font = pw.Font.ttf(ByteData.sublistView(input.font));
  final bold = pw.Font.helveticaBold();
  final document =
      pw.Document(title: 'Urban Blade order receipt', author: 'Urban Blade');
  String money(Object? value) =>
      'INR ${(num.tryParse('$value') ?? 0).toStringAsFixed(2)}';
  String value(String key, [String fallback = 'Not available']) {
    final text = '${order[key] ?? ''}'.trim();
    return text.isEmpty ? fallback : text;
  }

  final status = value('payment_status', 'pending').toLowerCase();
  final paid = status == 'paid' || status == 'captured';
  final statusLabel = switch (status) {
    'paid' || 'captured' => 'PAID',
    'authorized' => 'AWAITING CAPTURE',
    'partially_refunded' => 'PARTIALLY REFUNDED',
    _ => status.replaceAll('_', ' ').toUpperCase(),
  };
  final statusColor = paid
      ? const PdfColor.fromInt(0xFF166534)
      : status == 'failed'
          ? const PdfColor.fromInt(0xFF991B1B)
          : const PdfColor.fromInt(0xFF92400E);
  final items = order['items'] is List
      ? (order['items'] as List).whereType<Map>().toList()
      : <Map>[];
  final address = order['shipping_address'] is Map
      ? order['shipping_address'] as Map
      : const {};
  final addressLines = [
    'fullName',
    'street',
    'city',
    'state',
    'postalCode',
    'phone'
  ]
      .map((key) => '${address[key] ?? ''}'.trim())
      .where((v) => v.isNotEmpty)
      .join('\n');
  final parsedDate = DateTime.tryParse(value('created_at', ''));
  final date = parsedDate == null
      ? value('created_at')
      : '${parsedDate.toUtc().toIso8601String().substring(0, 10)} ${parsedDate.toUtc().toIso8601String().substring(11, 16)} UTC';

  pw.Widget heading(String text) => pw.Padding(
      padding: const pw.EdgeInsets.only(bottom: 10),
      child: pw.Text(text,
          style: pw.TextStyle(
              font: bold, fontSize: 10, color: ink, letterSpacing: .6)));
  pw.Widget field(String label, String text) => pw.Padding(
      padding: const pw.EdgeInsets.only(bottom: 7),
      child: pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
        pw.SizedBox(
            width: 90,
            child: pw.Text(label,
                style: const pw.TextStyle(color: slate, fontSize: 9))),
        pw.Expanded(
            child: pw.Text(text, style: const pw.TextStyle(fontSize: 9))),
      ]));
  pw.Widget amount(String label, Object? amount) => pw.Padding(
      padding: const pw.EdgeInsets.symmetric(vertical: 5),
      child: pw.Row(children: [
        pw.Expanded(
            child: pw.Text(label,
                style: const pw.TextStyle(color: slate, fontSize: 9))),
        pw.Text(money(amount), style: const pw.TextStyle(fontSize: 10)),
      ]));

  document.addPage(pw.MultiPage(
    pageFormat: PdfPageFormat.a4,
    margin: const pw.EdgeInsets.fromLTRB(42, 36, 42, 38),
    maxPages: 200,
    theme: pw.ThemeData.withFont(base: font, bold: bold).copyWith(
        defaultTextStyle:
            pw.TextStyle(font: font, fontSize: 10, color: ink, lineSpacing: 3)),
    header: (context) => pw.Column(children: [
      pw.Container(height: 4, color: amber),
      pw.SizedBox(height: 17),
      pw.Row(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
          children: [
            pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  pw.Text('URBAN BLADE',
                      style: pw.TextStyle(
                          font: bold, fontSize: 19, letterSpacing: 1.5)),
                  pw.SizedBox(height: 5),
                  pw.Text('GROOMING & CARE',
                      style: const pw.TextStyle(
                          fontSize: 8, letterSpacing: 1.4, color: slate)),
                ]),
            pw.Text(
                context.pageNumber == 1 ? 'Order receipt' : 'Receipt continued',
                style: pw.TextStyle(font: bold, fontSize: 20)),
          ]),
      pw.SizedBox(height: 20),
    ]),
    footer: (context) => pw.Column(children: [
      pw.Divider(color: line),
      pw.Row(mainAxisAlignment: pw.MainAxisAlignment.spaceBetween, children: [
        pw.Text('URBAN BLADE  /  Order receipt',
            style: const pw.TextStyle(fontSize: 8, color: slate)),
        pw.Text('${context.pageNumber} / ${context.pagesCount}',
            style: const pw.TextStyle(fontSize: 8, color: slate)),
      ]),
    ]),
    build: (_) => [
      pw.Container(
          padding: const pw.EdgeInsets.all(16),
          decoration: pw.BoxDecoration(
              color: paper, borderRadius: pw.BorderRadius.circular(8)),
          child: pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Row(
                    mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                    children: [
                      pw.Text('ORDER TOTAL',
                          style: pw.TextStyle(
                              font: bold, fontSize: 9, color: slate)),
                      pw.Container(
                          padding: const pw.EdgeInsets.symmetric(
                              horizontal: 10, vertical: 5),
                          decoration: pw.BoxDecoration(
                              border: pw.Border.all(color: statusColor),
                              borderRadius: pw.BorderRadius.circular(4)),
                          child: pw.Text(statusLabel,
                              style: pw.TextStyle(
                                  font: bold,
                                  fontSize: 9,
                                  color: statusColor))),
                    ]),
                pw.SizedBox(height: 6),
                pw.Text(money(order['total_amount']),
                    style: pw.TextStyle(font: bold, fontSize: 26)),
                pw.SizedBox(height: 15),
                field('Order ID', value('id')),
                field('Order date', date),
                field('Payment method', value('payment_method')),
                if (value('transaction_id', '').isNotEmpty)
                  field('Transaction ID', value('transaction_id')),
              ])),
      pw.SizedBox(height: 24),
      heading('YOUR ITEMS'),
      if (items.isEmpty)
        pw.Text('Item details are unavailable.')
      else
        pw.TableHelper.fromTextArray(
          headers: ['Item', 'Qty', 'Unit price', 'Amount'],
          data: [
            for (final item in items)
              [
                '${item['product_name'] ?? 'Item'}',
                '${item['quantity'] ?? 0}',
                money(item['unit_price']),
                money((num.tryParse('${item['unit_price']}') ?? 0) *
                    (num.tryParse('${item['quantity']}') ?? 0)),
              ]
          ],
          columnWidths: {
            0: const pw.FlexColumnWidth(4.2),
            1: const pw.FlexColumnWidth(.6),
            2: const pw.FlexColumnWidth(1.6),
            3: const pw.FlexColumnWidth(1.6)
          },
          headerStyle:
              pw.TextStyle(font: bold, fontSize: 9, color: PdfColors.white),
          cellStyle: const pw.TextStyle(fontSize: 9),
          headerDecoration: const pw.BoxDecoration(color: ink),
          oddRowDecoration: const pw.BoxDecoration(color: paper),
          headerAlignment: pw.Alignment.centerLeft,
          headerAlignments: {
            1: pw.Alignment.centerRight,
            2: pw.Alignment.centerRight,
            3: pw.Alignment.centerRight
          },
          cellAlignments: {
            1: pw.Alignment.topRight,
            2: pw.Alignment.topRight,
            3: pw.Alignment.topRight
          },
          cellPadding:
              const pw.EdgeInsets.symmetric(horizontal: 10, vertical: 11),
          border: const pw.TableBorder(
              horizontalInside: pw.BorderSide(color: line, width: .5)),
        ),
      pw.SizedBox(height: 22),
      pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
        pw.Expanded(
            child: pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
              heading('DELIVER TO'),
              pw.Text(
                  addressLines.isEmpty ? 'Address not available' : addressLines,
                  style: const pw.TextStyle(fontSize: 10)),
            ])),
        pw.SizedBox(width: 24),
        pw.SizedBox(
            width: 220,
            child: pw.Column(children: [
              amount('Subtotal', order['subtotal']),
              amount('Delivery', order['shipping_fee']),
              amount('Discount',
                  -(num.tryParse('${order['discount_amount']}') ?? 0)),
              if (order['tax_amount'] != null)
                amount('Tax', order['tax_amount']),
              pw.Divider(color: line),
              pw.Container(
                  padding: const pw.EdgeInsets.all(12),
                  color: ink,
                  child: pw.Row(children: [
                    pw.Expanded(
                        child: pw.Text('TOTAL',
                            style: pw.TextStyle(
                                font: bold,
                                color: PdfColors.white,
                                fontSize: 10))),
                    pw.Text(money(order['total_amount']),
                        style: pw.TextStyle(
                            font: bold, color: PdfColors.white, fontSize: 12)),
                  ])),
            ])),
      ]),
      pw.SizedBox(height: 24),
      pw.Text(
          paid
              ? 'Thank you for your order.'
              : 'This receipt records your order. Payment has not been marked paid.',
          style: pw.TextStyle(font: bold, fontSize: 10)),
      pw.SizedBox(height: 6),
      pw.Text(
          'Payment status reflects the order record at download time. Keep this receipt for your records.',
          style: const pw.TextStyle(fontSize: 8, color: slate)),
    ],
  ));
  return document.save();
}
