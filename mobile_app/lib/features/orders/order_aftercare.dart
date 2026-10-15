import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/models/order_model.dart';
import '../../core/models/order_return_model.dart';
import '../../core/services/app_state.dart';
import '../../core/widgets/commerce_ui.dart';
import '../../core/widgets/glass_panel.dart';
import '../../core/widgets/premium_scaffold.dart';

String accountMoney(num amount, [String currency = 'INR']) =>
    NumberFormat.currency(
      locale: 'en_IN',
      name: currency,
      symbol: currency == 'INR' ? '₹' : currency,
      decimalDigits: 2,
    ).format(amount);
String _date(DateTime date) => DateFormat('d MMM yyyy').format(date.toLocal());

class OrderAftercarePanel extends StatelessWidget {
  final OrderModel order;
  const OrderAftercarePanel({super.key, required this.order});
  @override
  Widget build(BuildContext context) {
    final data = order.aftercare;
    if (!data.hasRecord) return const SizedBox.shrink();
    final step = switch (data.returnStatus) {
      'requested' => 0,
      'approved' => 1,
      'received' => 2,
      _ => -1,
    };
    final closed =
        data.refundStatus == 'processed' || (step == 2 && order.uncollectedCod);
    final stages = [
      'Requested',
      'Approved',
      'Received',
      order.uncollectedCod ? 'Closed' : 'Refunded',
    ];
    final next = switch (data.returnStatus) {
      'requested' =>
        'Your request is being reviewed. Keep the products and packaging ready while you wait for a decision.',
      'approved' =>
        'Follow the return instructions in the review note. Contact support if collection or shipping details have not been provided.',
      'rejected' =>
        'Your return was declined. Contact support with your order number if you need help with the decision.',
      'received' =>
        order.uncollectedCod
            ? 'The returned parcel has been inspected and the return is closed.'
            : data.refundStatus == 'processed'
            ? 'The returned parcel has been inspected and the refund is complete.'
            : 'The returned parcel has been inspected. Refund progress appears below once repayment begins.',
      _ =>
        'Payment and refund progress are recorded separately from delivery status.',
    };
    return CommercePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            data.returnStatus == null ? data.refundLabel : data.returnLabel,
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
          ),
          if (data.requestedAt != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text('Requested ${_date(data.requestedAt!)}'),
            ),
          if (step >= 0)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 14),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (var i = 0; i < stages.length; i++)
                    Chip(
                      label: Text(stages[i]),
                      avatar: Icon(
                        i <= step || i == 3 && closed
                            ? Icons.check_circle_outline
                            : Icons.circle_outlined,
                        size: 16,
                      ),
                    ),
                ],
              ),
            ),
          const SizedBox(height: 8),
          Text(next),
          if (data.returnReason != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text('Reason: ${data.returnReason}'),
            ),
          if (data.reviewNote != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text('Review note: ${data.reviewNote}'),
            ),
          if (data.refundStatus == 'pending')
            const Padding(
              padding: EdgeInsets.only(top: 12),
              child: Text(
                'Refund processing. Settlement will be confirmed after the payment provider updates its status.',
              ),
            ),
          if (data.refundStatus == 'failed')
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                'Refund needs attention. Our team will review the payment and retry when appropriate.',
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          if (data.refundFailureReason != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(data.refundFailureReason!),
            ),
          if (data.refundStatus == 'processed')
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                'Refund completed: ${data.refundAmount == null ? 'Amount awaiting confirmation' : accountMoney(data.refundAmount!, order.currency)}${data.refundedAt == null ? '' : ' on ${_date(data.refundedAt!)}'}',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
          if (order.uncollectedCod && data.returnStatus == 'received')
            const Padding(
              padding: EdgeInsets.only(top: 12),
              child: Text(
                'Return complete. No refund is due because no COD payment was collected.',
              ),
            ),
          if (data.refundId != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: SelectableText('Refund reference: ${data.refundId}'),
            ),
          if (data.refundExternalReference != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: SelectableText(
                'Repayment reference: ${data.refundExternalReference}',
              ),
            ),
        ],
      ),
    );
  }
}

Future<void> showReturnRequest(
  BuildContext context,
  AppState state,
  OrderModel order,
) async {
  await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => GlassPanel(
      radius: 28,
      child: _ReturnRequest(state: state, order: order),
    ),
  );
}

class _ReturnRequest extends StatefulWidget {
  final AppState state;
  final OrderModel order;
  const _ReturnRequest({required this.state, required this.order});
  @override
  State<_ReturnRequest> createState() => _ReturnRequestState();
}

class _ReturnRequestState extends State<_ReturnRequest> {
  final _form = GlobalKey<FormState>();
  final _details = TextEditingController();
  late final Object _session = widget.state.accountSessionKey;
  String? _category, _error;
  bool _acknowledged = false, _busy = false;
  @override
  void dispose() {
    _details.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy || !(_form.currentState?.validate() ?? false)) return;
    if (!_acknowledged) {
      setState(
        () => _error = 'Confirm that this request covers the full order.',
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.state.requestOrderReturn(
        widget.order,
        _category!,
        _details.text,
        _acknowledged,
      );
      if (mounted && _session == widget.state.accountSessionKey) {
        Navigator.pop(context, true);
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.state,
    builder: (context, _) {
      if (_session != widget.state.accountSessionKey) {
        return const Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Your account changed. Close this form and sign in again.',
          ),
        );
      }
      return PopScope(
        canPop: !_busy,
        child: SafeArea(
          top: false,
          child: Padding(
            padding: EdgeInsets.only(
              bottom: MediaQuery.viewInsetsOf(context).bottom,
            ),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Form(
                key: _form,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    CommerceSheetHeader(
                      title: 'Request a product return',
                      icon: Icons.assignment_return_outlined,
                      onClose: _busy ? () {} : () => Navigator.pop(context),
                    ),
                    const SizedBox(height: 12),
                    Text('Order ${widget.order.id}'),
                    const SizedBox(height: 12),
                    const Text(
                      'This request covers all listed products and quantities. Our team reviews the request and inspects the returned parcel before arranging any refund due. Uncollected COD orders have no payment to refund.',
                    ),
                    const SizedBox(height: 14),
                    for (final item in widget.order.items)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Text(
                          '${item.product.name} · Qty ${item.quantity}',
                        ),
                      ),
                    Text(
                      'Original order total: ${accountMoney(widget.order.grandTotal, widget.order.currency)}',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 18),
                    DropdownButtonFormField<String>(
                      isExpanded: true,
                      itemHeight: 72,
                      decoration: const InputDecoration(
                        labelText: 'Reason for return',
                      ),
                      items: returnReasons
                          .map(
                            (reason) => DropdownMenuItem(
                              value: reason,
                              child: Text(
                                reason,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          )
                          .toList(),
                      selectedItemBuilder: (context) => returnReasons
                          .map(
                            (reason) => Text(
                              reason,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          )
                          .toList(),
                      onChanged: _busy
                          ? null
                          : (value) => setState(() => _category = value),
                      validator: (value) =>
                          value == null ? 'Choose a reason' : null,
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _details,
                      enabled: !_busy,
                      minLines: 3,
                      maxLines: 5,
                      maxLength: 400,
                      decoration: const InputDecoration(
                        labelText: 'Tell us what happened',
                        helperText:
                            '3–400 characters. Include useful product or delivery details.',
                        helperMaxLines: 3,
                      ),
                      validator: (value) => (value ?? '').trim().length < 3
                          ? 'Describe the issue in at least 3 characters'
                          : null,
                    ),
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      value: _acknowledged,
                      onChanged: _busy
                          ? null
                          : (value) =>
                                setState(() => _acknowledged = value ?? false),
                      title: const Text(
                        'I understand this is a request to return the full order, including every listed product and quantity.',
                      ),
                    ),
                    const Text(
                      'Keep the products and packaging until you receive instructions. Submitting a request does not start a refund or book a collection.',
                    ),
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Text(
                          _error!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ),
                    const SizedBox(height: 18),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      child: Text(
                        _busy ? 'Submitting…' : 'Submit return request',
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    },
  );
}

class ReturnDetailsScreen extends StatefulWidget {
  final AppState state;
  final OrderModel order;
  const ReturnDetailsScreen({
    super.key,
    required this.state,
    required this.order,
  });
  @override
  State<ReturnDetailsScreen> createState() => _ReturnDetailsScreenState();
}

class _ReturnDetailsScreenState extends State<ReturnDetailsScreen>
    with WidgetsBindingObserver {
  late final Object _session = widget.state.accountSessionKey;
  ReturnAudit? _audit;
  String? _error;
  bool _loading = false;
  Timer? _timer;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _refresh();
    });
    _timer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted &&
          WidgetsBinding.instance.lifecycleState != AppLifecycleState.paused &&
          ModalRoute.of(context)?.isCurrent == true) {
        _refresh();
      }
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _refresh() async {
    if (!mounted || _loading || _session != widget.state.accountSessionKey) {
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final audit = await widget.state.loadReturnAudit(widget.order.id);
      if (mounted && _session == widget.state.accountSessionKey) {
        setState(() => _audit = audit);
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.state,
    builder: (context, _) {
      final order = _audit?.order ?? widget.order;
      return PremiumScaffold(
        appBar: AppBar(title: const Text('Return & refund details')),
        body: _session != widget.state.accountSessionKey
            ? const Center(child: Text('Sign in again to view this return.'))
            : RefreshIndicator(
                onRefresh: _refresh,
                child: ListView(
                  padding: const EdgeInsets.all(20),
                  physics: const AlwaysScrollableScrollPhysics(),
                  children: [
                    SelectableText('Order ${order.id}'),
                    const SizedBox(height: 14),
                    if (_loading) const LinearProgressIndicator(),
                    if (_error != null) ...[
                      Text(
                        _error!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                      TextButton(
                        onPressed: _refresh,
                        child: const Text('Retry return history'),
                      ),
                    ],
                    OrderAftercarePanel(order: order),
                    const SizedBox(height: 22),
                    Text(
                      'Return timeline',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    if (_audit != null && _audit!.events.isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 16),
                        child: Text('No return events recorded yet.'),
                      ),
                    for (final event in _audit?.events ?? <ReturnEvent>[])
                      ListTile(
                        contentPadding: const EdgeInsets.symmetric(vertical: 8),
                        leading: const Icon(Icons.history),
                        title: Text(event.status.replaceAll('_', ' ')),
                        subtitle: Text(
                          '${event.createdAt == null ? '' : '${_date(event.createdAt!)}\n'}${event.note}',
                        ),
                      ),
                  ],
                ),
              ),
      );
    },
  );
}
