import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/app_state.dart';
import '../../core/services/receipt_exporter.dart';
import '../../core/widgets/commerce_ui.dart';

class ReceiptSheet extends StatefulWidget {
  final AppState state;
  final String orderId;
  const ReceiptSheet({super.key, required this.state, required this.orderId});
  @override
  State<ReceiptSheet> createState() => _ReceiptSheetState();
}

class _ReceiptSheetState extends State<ReceiptSheet> {
  late Future<dynamic> _receipt;
  bool _saving = false;

  Future<void> _download(Map data) async {
    if (_saving) return;
    setState(() => _saving = true);
    try {
      final saved = await ReceiptExporter.save(data);
      if (mounted && saved) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Receipt saved.')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Could not save the receipt. Please try again and choose a writable folder.',
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<dynamic> _load() => widget.state.api.request(
    'GET',
    'orders/${Uri.encodeComponent(widget.orderId)}',
  );
  @override
  void initState() {
    super.initState();
    _receipt = _load();
  }

  String _money(dynamic value) =>
      '₹${(num.tryParse('$value') ?? 0).toStringAsFixed(2)}';
  Widget _line(String label, dynamic value, {bool total = false}) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              fontSize: total ? 16 : 13,
              color: AppColors.of(context).secondary,
            ),
          ),
        ),
        const SizedBox(width: 12),
        Flexible(
          child: Text(
            _money(value),
            style: TextStyle(
              fontSize: total ? 23 : 14,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    ),
  );
  @override
  Widget build(BuildContext context) => FutureBuilder<dynamic>(
    future: _receipt,
    builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) {
        return const Center(child: CircularProgressIndicator());
      }
      if (snapshot.hasError || snapshot.data is! Map) {
        return Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.receipt_long_outlined,
                  size: 40,
                  color: AppColors.of(context).secondary,
                ),
                const SizedBox(height: 16),
                const Text(
                  'Receipt unavailable',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                const Text(
                  'We couldn’t retrieve this receipt. Please try again.',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: () => setState(() {
                    _receipt = _load();
                  }),
                  child: const Text('Retry receipt'),
                ),
              ],
            ),
          ),
        );
      }
      final data = snapshot.data as Map;
      final address = data['shipping_address'] as Map? ?? {};
      final status = '${data['payment_status'] ?? 'pending'}';
      return ListView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 30),
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Order receipt',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
              ),
              IconButton(
                tooltip: 'Close receipt',
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close),
              ),
            ],
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _saving ? null : () => _download(data),
            icon: const Icon(Icons.download_outlined),
            label: Text(_saving ? 'Saving receipt…' : 'Download receipt (PDF)'),
          ),
          const SizedBox(height: 16),
          CommercePanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'URBAN BLADE',
                  style: TextStyle(
                    fontSize: 12,
                    letterSpacing: 2,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 18),
                Text(
                  _money(data['total_amount']),
                  style: const TextStyle(
                    fontSize: 32,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 10),
                StatusPill(
                  paymentLabel(status),
                  warning: status == 'pending',
                  error: status == 'failed',
                ),
                const SizedBox(height: 20),
                Text(
                  'Order ID',
                  style: TextStyle(
                    fontSize: 11,
                    color: AppColors.of(context).secondary,
                  ),
                ),
                SelectableText('${data['id'] ?? widget.orderId}'),
                const SizedBox(height: 12),
                Text(
                  '${data['payment_method'] ?? 'Payment method unavailable'}',
                ),
                if ((data['transaction_id'] ?? '').toString().isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(
                    'Transaction ID',
                    style: TextStyle(
                      fontSize: 11,
                      color: AppColors.of(context).secondary,
                    ),
                  ),
                  SelectableText('${data['transaction_id']}'),
                ],
                const Divider(height: 32),
                ...((data['items'] as List?) ?? []).map(
                  (item) => Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            '${item['quantity']} × ${item['product_name']}',
                          ),
                        ),
                        const SizedBox(width: 12),
                        Flexible(
                          child: Text(
                            '${_money(item['unit_price'])} each',
                            style: const TextStyle(fontSize: 12),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const Divider(height: 24),
                _line('Subtotal', data['subtotal']),
                _line('Delivery', data['shipping_fee']),
                _line(
                  'Discount',
                  -(num.tryParse('${data['discount_amount']}') ?? 0),
                ),
                if (data['tax_amount'] != null)
                  _line('Tax', data['tax_amount']),
                const Divider(height: 24),
                _line('Total', data['total_amount'], total: true),
                const Divider(height: 32),
                const Text(
                  'Delivery address',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                SelectableText(
                  ['fullName', 'street', 'city', 'state', 'postalCode', 'phone']
                      .map((key) => address[key] ?? '')
                      .where((v) => v.toString().isNotEmpty)
                      .join(', '),
                ),
              ],
            ),
          ),
        ],
      );
    },
  );
}
