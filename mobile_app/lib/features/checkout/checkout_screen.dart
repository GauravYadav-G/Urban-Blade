import 'dart:async';
import '../../core/widgets/premium_scaffold.dart';
import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/app_state.dart';
import '../../core/services/payment_gateway.dart';
import '../../core/models/order_model.dart';
import '../../core/widgets/delivery_editor.dart';
import '../../core/widgets/commerce_ui.dart';
import '../orders/receipt_sheet.dart';

class CheckoutScreen extends StatefulWidget {
  final AppState state;
  final VoidCallback onOrderPlaced;
  final PaymentGateway? gateway;
  const CheckoutScreen(
      {super.key,
      required this.state,
      required this.onOrderPlaced,
      this.gateway});
  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen>
    with WidgetsBindingObserver {
  late final PaymentGateway _gateway;
  bool _busy = false;
  bool _gatewayOpen = false;
  bool _reconciling = false;
  String _progress = 'Checking current prices…';
  String _method = 'online';
  String _upiApp = 'any';
  String? _error;
  Map<String, dynamic>? _quote;
  OrderModel? _order;
  @override
  void initState() {
    super.initState();
    _gateway = widget.gateway ?? RazorpayGateway();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (widget.state.pendingPayment != null) {
        _checkStatus();
      } else {
        _loadQuote();
      }
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _gateway.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed &&
        widget.state.pendingPayment != null) {
      if (_gatewayOpen) {
        unawaited(_reconcileWhileCheckoutOpen());
      } else if (!_busy) {
        unawaited(_checkStatus());
      }
    }
  }

  Future<void> _reconcileWhileCheckoutOpen() async {
    if (_reconciling || !mounted || widget.state.pendingPayment == null) return;
    setState(() => _reconciling = true);
    try {
      final order = await widget.state.checkPendingPayment();
      if (!mounted) return;
      if (order != null) setState(() => _order = order);
    } catch (_) {
      // The SDK still owns the active attempt. A status/network failure must
      // never start a second payment or replace a later verified callback.
      if (mounted) {
        setState(() => _error =
            'Could not refresh payment status. Keep this checkout open and try Check status again.');
      }
    } finally {
      if (mounted) setState(() => _reconciling = false);
    }
  }

  void _showProgress(String message) {
    if (mounted) setState(() => _progress = message);
  }

  Future<void> _loadQuote() async {
    if (_busy || !mounted) return;
    setState(() {
      _busy = true;
      _progress = 'Checking current prices…';
      _error = null;
    });
    try {
      final quote = await widget.state.getAuthoritativeQuote();
      if (mounted) setState(() => _quote = quote);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _checkStatus() async {
    if (_busy || !mounted) return;
    setState(() {
      _busy = true;
      _progress = 'Confirming payment status…';
      _error = null;
    });
    try {
      final order = await widget.state.checkPendingPayment();
      if (mounted) {
        setState(() {
          _order = order;
          if (order == null) {
            _error = widget.state.pendingPayment == null
                ? 'This payment attempt expired. Your cart is ready for a new checkout.'
                : 'Payment is not confirmed yet. Check status if you were debited, or resume the same checkout.';
          }
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pay() async {
    if (_busy) return;
    final state = widget.state;
    final checkoutColor =
        '#${Theme.of(context).colorScheme.primary.toARGB32().toRadixString(16).padLeft(8, '0').substring(2)}';
    if (state.pendingPayment == null &&
        (state.homeAddress.isEmpty ||
            state.postalCode.isEmpty ||
            (state.deliveryPhone.isEmpty && state.userPhone.isEmpty))) {
      final saved = await editDeliveryAddress(context, state);
      if (!mounted || !saved) return;
    }
    setState(() {
      _busy = true;
      _progress = 'Preparing your secure checkout…';
      _error = null;
    });
    try {
      if (state.pendingPayment == null) {
        final quote = await state.getAuthoritativeQuote();
        if (!mounted) return;
        if (quote == null) {
          throw Exception('Could not retrieve current prices.');
        }
        if (_quote == null || _quote!['totalAmount'] != quote['totalAmount']) {
          if (mounted) {
            setState(() {
              _quote = quote;
              _error =
                  'Your total has been updated. Review it below before continuing.';
            });
          }
          return;
        }
        state.reviewedTotal = quote['totalAmount'] as num;
        if (_method == 'cod') {
          final order = await state.placeCodOrder();
          if (mounted) setState(() => _order = order);
          return;
        }
        await state.createRazorpayOrder();
        if (!mounted) return;
      } else {
        final settled = await state.checkPendingPayment();
        if (!mounted) return;
        if (settled != null) {
          if (mounted) setState(() => _order = settled);
          return;
        }
        if (state.pendingPayment == null) {
          if (mounted) {
            setState(() => _error =
                'This attempt expired. Review your cart and try again.');
          }
          return;
        }
        final verification = state.pendingPayment!['verification'];
        if (verification is Map) {
          final order = await state.finalizeRazorpayOrder(
              orderId: verification['orderId'],
              razorpayOrderId: verification['razorpayOrderId'],
              razorpayPaymentId: verification['razorpayPaymentId'],
              razorpaySignature: verification['razorpaySignature'],
              amountInPaise: (state.pendingPayment!['amount'] as num).toInt());
          if (mounted) setState(() => _order = order);
          return;
        }
      }
      if (!mounted) return;
      final payment = state.pendingPayment;
      if (payment == null) {
        throw Exception(
            'This checkout session ended. Review your cart and try again.');
      }
      if (_method == 'upi' && '${payment['keyId']}'.startsWith('rzp_test_')) {
        throw Exception(
            'UPI app handoff is not available in this store’s test checkout. Select Pay securely online to test, or ask the store to enable live payments.');
      }
      _showProgress(_method == 'upi'
          ? 'Opening secure UPI checkout…'
          : 'Opening secure checkout…');
      _gatewayOpen = true;
      final result = await _gateway.open({
        'key': payment['keyId'],
        'order_id': payment['razorpayOrderId'],
        'amount': payment['amount'],
        'currency': payment['currency'] ?? 'INR',
        'name': 'Urban Blade',
        'description': 'Grooming essentials',
        'prefill': {
          'name':
              state.deliveryName.isEmpty ? state.userName : state.deliveryName,
          'contact': state.deliveryPhone.isEmpty
              ? state.userPhone
              : state.deliveryPhone,
          'email': state.userEmail,
          if (_method == 'upi') 'method': 'upi'
        },
        'theme': {'color': checkoutColor},
        if (_method == 'upi') 'config': upiCheckoutConfiguration(_upiApp),
        'retry': {'enabled': true, 'max_count': 2},
      });
      _gatewayOpen = false;
      if (!mounted) return;
      if (_order != null) return;
      _showProgress('Verifying your payment…');
      if (result.succeeded) {
        final order = await state.finalizeRazorpayOrder(
            orderId: payment['orderId'].toString(),
            razorpayOrderId: result.orderId!,
            razorpayPaymentId: result.paymentId!,
            razorpaySignature: result.signature!,
            amountInPaise: (payment['amount'] as num).toInt());
        if (mounted) setState(() => _order = order);
      } else {
        // A failed callback does not prove that money was not captured. Reconcile first.
        final order = await state.checkPendingPayment();
        if (mounted) {
          setState(() {
            _order = order;
            if (order == null) {
              _error = result.cancelled
                  ? 'Checkout closed. You can resume the same payment or check its status.'
                  : result.error ??
                      'Payment is awaiting confirmation. Check status before paying again.';
            }
          });
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      _gatewayOpen = false;
      if (mounted) setState(() => _busy = false);
    }
  }

  String _money(dynamic value) =>
      '₹${(num.tryParse('$value') ?? 0).toStringAsFixed(2)}';
  Widget _line(String label, dynamic value, {bool total = false}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(children: [
        Expanded(
            child: Text(label,
                style: TextStyle(
                    fontWeight: total ? FontWeight.w700 : FontWeight.w400))),
        const SizedBox(width: 12),
        Flexible(
            child: Text(_money(value),
                textAlign: TextAlign.end,
                style: TextStyle(
                    fontSize: total ? 22 : 15, fontWeight: FontWeight.w700)))
      ]));
  Widget _panel(Widget child) => CommercePanel(child: child);
  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    final pending = state.pendingPayment;
    final quote = pending ?? _quote;
    return PopScope(
        canPop: !_busy || _order != null,
        child: PremiumScaffold(
          appBar: AppBar(title: const Text('Checkout')),
          bottomNavigationBar: _order != null
              ? null
              : SafeArea(
                  top: false,
                  child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                      child: CommerceActionArea(
                          child:
                              Column(mainAxisSize: MainAxisSize.min, children: [
                        if (_error != null)
                          Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: Semantics(
                                  liveRegion: true,
                                  child: Text(_error!,
                                      maxLines: 4,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                          fontSize: 12,
                                          color:
                                              AppColors.of(context).error)))),
                        SizedBox(
                            width: double.infinity,
                            child: FilledButton(
                                onPressed: _busy
                                    ? null
                                    : quote == null
                                        ? _loadQuote
                                        : _pay,
                                child: AnimatedSwitcher(
                                    duration:
                                        MediaQuery.disableAnimationsOf(context)
                                            ? Duration.zero
                                            : const Duration(milliseconds: 200),
                                    child: _busy
                                        ? Row(
                                            key: const ValueKey('payment-busy'),
                                            mainAxisSize: MainAxisSize.min,
                                            children: [
                                                const SizedBox(
                                                    width: 18,
                                                    height: 18,
                                                    child:
                                                        CircularProgressIndicator(
                                                            strokeWidth: 2)),
                                                const SizedBox(width: 10),
                                                Flexible(
                                                    child: Text(_progress,
                                                        textAlign:
                                                            TextAlign.center)),
                                              ])
                                        : Text(quote == null
                                            ? 'Retry price check'
                                            : pending != null
                                                ? pending['verification'] !=
                                                        null
                                                    ? 'Retry confirmation'
                                                    : 'Resume secure checkout'
                                                : _method == 'cod'
                                                    ? 'Place order · ${_money(quote['totalAmount'])}'
                                                    : 'Pay · ${_money(quote['totalAmount'])}'))))
                      ])))),
          body: _order != null
              ? Center(
                  child: SingleChildScrollView(
                      padding: const EdgeInsets.all(28),
                      child: Column(children: [
                        const SuccessSeal(),
                        const SizedBox(height: 24),
                        Text('You’re all set.',
                            style: Theme.of(context).textTheme.headlineLarge),
                        const SizedBox(height: 12),
                        const Text(
                            'Your order is confirmed. You can find updates in your profile.',
                            textAlign: TextAlign.center),
                        const SizedBox(height: 20),
                        SelectableText('Order ${_order!.id}',
                            textAlign: TextAlign.center),
                        const SizedBox(height: 28),
                        FilledButton(
                            onPressed: widget.onOrderPlaced,
                            child: const Text('View my orders')),
                        const SizedBox(height: 12),
                        OutlinedButton.icon(
                            onPressed: () => showModalBottomSheet<void>(
                                context: context,
                                isScrollControlled: true,
                                useSafeArea: true,
                                builder: (_) => SizedBox(
                                    height:
                                        MediaQuery.sizeOf(context).height * .85,
                                    child: ReceiptSheet(
                                        state: state, orderId: _order!.id))),
                            icon: const Icon(Icons.receipt_long_outlined),
                            label: const Text('View / download receipt')),
                      ])))
              : ListView(padding: const EdgeInsets.all(20), children: [
                  CommerceIntro(
                      title: pending == null
                          ? 'Review your order'
                          : 'Let’s finish your payment.',
                      eyebrow: 'Secure checkout',
                      icon: Icons.lock_outline,
                      description: pending == null
                          ? 'Review your delivery details and the current total.'
                          : 'Your order is saved. We’ll verify its status before opening checkout again.'),
                  const SizedBox(height: 24),
                  _panel(Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(children: [
                          const Icon(Icons.location_on_outlined),
                          const SizedBox(width: 10),
                          const Expanded(
                              child: Text('Deliver to',
                                  style:
                                      TextStyle(fontWeight: FontWeight.w700))),
                          TextButton(
                              onPressed: _busy || pending != null
                                  ? null
                                  : () async {
                                      await editDeliveryAddress(context, state);
                                      if (mounted) setState(() {});
                                    },
                              child: const Text('Edit'))
                        ]),
                        Text(state.deliveryName.isEmpty
                            ? state.userName
                            : state.deliveryName),
                        const SizedBox(height: 6),
                        Text(state.homeAddress.isEmpty
                            ? 'Add a delivery address to continue'
                            : '${state.homeAddress}, ${state.city}, ${state.region} ${state.postalCode}'),
                        if (state.deliveryPhone.isNotEmpty)
                          Text(state.deliveryPhone),
                      ])),
                  const SizedBox(height: 16),
                  _panel(Column(children: [
                    RadioListTile<String>(
                        contentPadding: EdgeInsets.zero,
                        value: 'online',
                        groupValue: _method,
                        onChanged:
                            _busy ? null : (v) => setState(() => _method = v!),
                        title: const Text('Pay securely online'),
                        subtitle: const Text(
                            'UPI, cards and net banking · Razorpay')),
                    RadioListTile<String>(
                        contentPadding: EdgeInsets.zero,
                        value: 'upi',
                        groupValue: _method,
                        onChanged:
                            _busy ? null : (v) => setState(() => _method = v!),
                        title: const Text('Pay with UPI'),
                        subtitle:
                            const Text('Continue in your preferred UPI app')),
                    CommerceFlowTransition(
                        child: _method == 'upi'
                            ? Column(
                                key: const ValueKey('upi-options'),
                                children: [
                                    Wrap(spacing: 8, runSpacing: 8, children: [
                                      for (final app in const {
                                        'any': 'Any UPI app',
                                        'phonepe': 'PhonePe',
                                        'google_pay': 'Google Pay'
                                      }.entries)
                                        ChoiceChip(
                                            label: Text(app.value),
                                            selected: _upiApp == app.key,
                                            onSelected: _busy
                                                ? null
                                                : (_) => setState(
                                                    () => _upiApp = app.key)),
                                    ]),
                                    const Padding(
                                        padding:
                                            EdgeInsets.symmetric(vertical: 12),
                                        child: Text(
                                            'Select an app here, then tap Pay below. Secure checkout will show the apps available on this phone. You can choose another payment method if your app is unavailable.',
                                            style: TextStyle(fontSize: 12))),
                                  ])
                            : const SizedBox(
                                key: ValueKey('standard-options'))),
                    RadioListTile<String>(
                        contentPadding: EdgeInsets.zero,
                        value: 'cod',
                        groupValue: _method,
                        onChanged: _busy || pending != null
                            ? null
                            : (v) => setState(() => _method = v!),
                        title: const Text('Cash on delivery'),
                        subtitle: const Text('Pay when your order arrives')),
                  ])),
                  const SizedBox(height: 16),
                  _panel(Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Order summary',
                            style: TextStyle(
                                fontSize: 17, fontWeight: FontWeight.w700)),
                        const SizedBox(height: 12),
                        if (quote != null) ...[
                          _line('Items', quote['subtotal']),
                          _line('Delivery', quote['shippingFee']),
                          _line(
                              'Discount',
                              -(num.tryParse('${quote['discountAmount']}') ??
                                  0)),
                          if (quote['taxInclusive'] == false)
                            _line('Tax', quote['taxAmount']),
                          const Divider(),
                          _line('Total', quote['totalAmount'], total: true),
                        ] else
                          const Text('Checking current prices…'),
                      ])),
                  if (_busy)
                    Padding(
                        padding: const EdgeInsets.symmetric(vertical: 20),
                        child: _PaymentProgress(message: _progress)),
                  if (pending != null)
                    OutlinedButton.icon(
                        onPressed: _reconciling
                            ? null
                            : _gatewayOpen
                                ? _reconcileWhileCheckoutOpen
                                : _busy
                                    ? null
                                    : _checkStatus,
                        icon: const Icon(Icons.refresh),
                        label: const Text('Check payment status')),
                  const SizedBox(height: 12),
                  const SizedBox(height: 12),
                  Text(
                      'You can track your order and view your receipt after confirmation.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                          fontSize: 12,
                          color: AppColors.of(context).secondary)),
                ]),
        ));
  }
}

class _PaymentProgress extends StatelessWidget {
  final String message;
  const _PaymentProgress({required this.message});
  @override
  Widget build(BuildContext context) {
    final reduced = MediaQuery.disableAnimationsOf(context);
    final colors = Theme.of(context).colorScheme;
    return Semantics(
        liveRegion: true,
        child: RepaintBoundary(
            child: AnimatedSwitcher(
                duration:
                    reduced ? Duration.zero : const Duration(milliseconds: 220),
                transitionBuilder: (child, animation) => FadeTransition(
                    opacity: animation,
                    child: ScaleTransition(
                        scale: Tween<double>(begin: .96, end: 1)
                            .animate(animation),
                        child: child)),
                child: Row(key: ValueKey(message), children: [
                  Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                          color: colors.secondaryContainer,
                          borderRadius: BorderRadius.circular(14)),
                      child: Icon(
                          message.contains('UPI')
                              ? Icons.phone_iphone_rounded
                              : Icons.lock_outline_rounded,
                          color: colors.onSecondaryContainer,
                          size: 22)),
                  const SizedBox(width: 12),
                  Expanded(
                      child: Text(message,
                          style: TextStyle(
                              fontSize: 13, color: colors.onSurfaceVariant))),
                ]))));
  }
}
