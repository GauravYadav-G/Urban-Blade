import '../../core/widgets/premium_scaffold.dart';
import '../../core/widgets/glass_panel.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import '../../core/constants/app_colors.dart';
import '../../core/models/order_model.dart';
import '../../core/services/app_state.dart';
import '../../core/widgets/commerce_ui.dart';
import '../../core/widgets/stitch_image.dart';
import 'receipt_sheet.dart';
import 'order_aftercare.dart';

class OrdersScreen extends StatefulWidget {
  final AppState state;
  final VoidCallback onShopNew;
  final bool showPayments, showReturns;
  const OrdersScreen({
    super.key,
    required this.state,
    required this.onShopNew,
    this.showPayments = false,
    this.showReturns = false,
  });
  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen>
    with WidgetsBindingObserver {
  AppState get state => widget.state;
  late bool _payments;
  String _filter = 'All', _query = '';
  final _search = TextEditingController();
  Timer? _monitor;
  bool _foreground = true;
  bool _detailOpen = false;
  bool _hasRefreshed = false;

  @override
  void initState() {
    super.initState();
    _payments = widget.showPayments;
    if (widget.showReturns) _filter = 'Returns & refunds';
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
    _monitor = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_foreground &&
          (ModalRoute.of(context)?.isCurrent == true || _detailOpen) &&
          state.orders.any(
            (order) =>
                isOrderActive(order) ||
                ['pending', 'authorized'].contains(order.paymentStatus) ||
                order.aftercare.refundStatus == 'pending' ||
                [
                  'requested',
                  'approved',
                ].contains(order.aftercare.returnStatus),
          )) {
        _refresh();
      }
    });
  }

  @override
  void dispose() {
    _monitor?.cancel();
    _search.dispose();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState lifecycle) {
    _foreground = lifecycle == AppLifecycleState.resumed;
    if (_foreground) _refresh();
  }

  Future<void> _refresh() async {
    if (!mounted || state.isLoadingHistory || !state.isLoggedIn) return;
    await state.loadHistory();
    if (mounted && state.historyError == null) {
      setState(() => _hasRefreshed = true);
    }
  }

  bool _matches(OrderModel order) {
    final text =
        '${order.id} ${order.transactionId} ${order.items.map((i) => i.product.name).join(' ')}'
            .toLowerCase();
    if (!text.contains(_query.trim().toLowerCase())) return false;
    if (_filter == 'All') return true;
    if (_filter == 'Returns & refunds') return order.aftercare.hasRecord;
    if (_payments) return paymentLabel(order.paymentStatus) == _filter;
    if (_filter == 'Active') return isOrderActive(order);
    return order.statusDisplay == _filter;
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: state,
    builder: (context, _) {
      final orders = [...state.orders]
        ..sort((a, b) => b.orderDate.compareTo(a.orderDate));
      final visible = orders.where(_matches).toList();
      final active = orders.where(isOrderActive).length;
      final paid = orders
          .where(
            (o) => [
              'paid',
              'captured',
              'refunded',
              'partially_refunded',
            ].contains(o.paymentStatus),
          )
          .fold<num>(
            0,
            (sum, o) =>
                sum + (o.grandTotal - o.confirmedRefund).clamp(0, o.grandTotal),
          );
      final filters = _payments
          ? [
              'All',
              'Paid',
              'Pending',
              'Failed',
              'Refunded',
              'Partially refunded',
              'Awaiting capture',
            ]
          : ['All', 'Active', 'Delivered', 'Cancelled', 'Returns & refunds'];
      return PremiumScaffold(
        appBar: AppBar(
          title: Text(
            _payments
                ? 'Payment history'
                : _filter == 'Returns & refunds'
                ? 'Returns & refunds'
                : 'My orders',
          ),
          actions: [
            IconButton(
              onPressed: state.isLoadingHistory ? null : _refresh,
              icon: const Icon(Icons.refresh_rounded),
              tooltip: 'Refresh orders',
            ),
          ],
        ),
        body: RefreshIndicator(
          onRefresh: _refresh,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
            children: [
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: AppColors.of(context).surfaceContainerLow,
                  borderRadius: BorderRadius.circular(24),
                ),
                child: Row(
                  children: [
                    Icon(
                      _payments
                          ? Icons.account_balance_wallet_outlined
                          : Icons.local_shipping_outlined,
                      color: AppColors.of(context).onSurface,
                      size: 30,
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _payments
                                ? accountMoney(paid)
                                : '$active active ${active == 1 ? 'order' : 'orders'}',
                            style: TextStyle(
                              fontSize: 23,
                              fontWeight: FontWeight.w800,
                              color: AppColors.of(context).onSurface,
                            ),
                          ),
                          const SizedBox(height: 5),
                          Text(
                            _payments
                                ? 'Net paid after confirmed refunds'
                                : '${orders.length} orders in your history',
                            style: TextStyle(
                              fontSize: 12,
                              color: AppColors.of(context).secondary,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(child: _tab('Orders', false)),
                  const SizedBox(width: 8),
                  Expanded(child: _tab('Payments', true)),
                ],
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _search,
                onChanged: (value) => setState(() => _query = value),
                decoration: InputDecoration(
                  hintText: _payments
                      ? 'Search order or transaction'
                      : 'Search orders or products',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _query.isEmpty
                      ? null
                      : IconButton(
                          tooltip: 'Clear search',
                          onPressed: () {
                            _search.clear();
                            setState(() => _query = '');
                          },
                          icon: const Icon(Icons.close),
                        ),
                ),
              ),
              const SizedBox(height: 12),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: filters
                      .map(
                        (f) => Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            label: Text(f),
                            selected: _filter == f,
                            labelStyle: TextStyle(
                              fontFamily: 'PlusJakartaSans',
                              color: _filter == f
                                  ? Theme.of(
                                      context,
                                    ).colorScheme.onSecondaryContainer
                                  : AppColors.of(context).secondary,
                            ),
                            onSelected: (_) => setState(() => _filter = f),
                          ),
                        ),
                      )
                      .toList(),
                ),
              ),
              const SizedBox(height: 14),
              if (state.isLoadingHistory)
                const LinearProgressIndicator(minHeight: 2),
              if (_hasRefreshed)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(
                    'Pull down for the latest order status',
                    style: TextStyle(
                      fontSize: 11,
                      color: AppColors.of(context).secondary,
                    ),
                  ),
                ),
              if (state.historyError != null)
                CommercePanel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Updates are unavailable',
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
                      Text(state.historyError!),
                      TextButton(
                        onPressed: _refresh,
                        child: const Text('Try again'),
                      ),
                    ],
                  ),
                ),
              if (visible.isEmpty && !state.isLoadingHistory)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 26),
                  child: Column(
                    children: [
                      Icon(
                        _payments
                            ? Icons.receipt_long_outlined
                            : Icons.inventory_2_outlined,
                        size: 42,
                        color: AppColors.of(context).secondary,
                      ),
                      const SizedBox(height: 14),
                      Text(
                        orders.isEmpty
                            ? (_payments
                                  ? 'No payment records yet'
                                  : 'Your first order starts here')
                            : 'No matching records',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        orders.isEmpty
                            ? 'Your purchases will appear here after checkout.'
                            : 'Try a different search or status.',
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 16),
                      if (orders.isEmpty)
                        FilledButton(
                          onPressed: widget.onShopNew,
                          child: const Text('Explore the shop'),
                        )
                      else
                        TextButton(
                          onPressed: () {
                            _search.clear();
                            setState(() {
                              _query = '';
                              _filter = 'All';
                            });
                          },
                          child: const Text('Clear filters'),
                        ),
                    ],
                  ),
                ),
              ...visible.map(
                (order) => Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: _payments ? _paymentCard(order) : _orderCard(order),
                ),
              ),
            ],
          ),
        ),
      );
    },
  );

  Widget _tab(String label, bool payments) => OutlinedButton(
    style: OutlinedButton.styleFrom(
      backgroundColor: _payments == payments
          ? AppColors.of(context).secondaryContainer
          : Colors.transparent,
      side: BorderSide(
        color: _payments == payments
            ? AppColors.of(context).onSurface
            : AppColors.of(context).outlineVariant,
      ),
    ),
    onPressed: () => setState(() {
      _payments = payments;
      _filter = 'All';
    }),
    child: Text(label),
  );

  Widget _orderCard(OrderModel order) => CommercePanel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 10,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            StatusPill(
              order.statusDisplay,
              error: order.status == OrderStatus.cancelled,
            ),
            Text(
              DateFormat('d MMM yyyy').format(order.orderDate.toLocal()),
              style: TextStyle(
                fontSize: 11,
                color: AppColors.of(context).secondary,
              ),
            ),
          ],
        ),
        const SizedBox(height: 14),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (order.items.isNotEmpty) ...[
              StitchImage(
                imageUrl: order.items.first.product.imageUrl,
                width: 64,
                height: 76,
                borderRadius: BorderRadius.circular(14),
              ),
              const SizedBox(width: 12),
            ],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    order.items.isEmpty
                        ? 'Grooming essentials'
                        : order.items.first.product.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    '${order.items.fold<int>(0, (sum, i) => sum + i.quantity)} ${order.items.fold<int>(0, (sum, i) => sum + i.quantity) == 1 ? 'item' : 'items'} · ${accountMoney(order.grandTotal, order.currency)}',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    'Order ${order.id}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 10,
                      color: AppColors.of(context).secondary,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        if (isOrderActive(order)) ...[
          Row(
            children: List.generate(
              4,
              (i) => Expanded(
                child: Container(
                  height: 4,
                  margin: const EdgeInsets.only(right: 4),
                  decoration: BoxDecoration(
                    color: i <= order.statusStep
                        ? AppColors.of(context).onSurface
                        : AppColors.of(context).outlineVariant,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
        ],
        Wrap(
          spacing: 12,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            if (order.aftercare.hasRecord)
              StatusPill(
                order.aftercare.returnStatus == null
                    ? order.aftercare.refundLabel
                    : order.aftercare.returnLabel,
              ),
            StatusPill(
              paymentLabel(order.paymentStatus),
              warning: order.paymentStatus == 'pending',
              error: order.paymentStatus == 'failed',
            ),
            TextButton.icon(
              onPressed: () => _openDetails(order.id),
              icon: const Icon(Icons.arrow_forward_rounded, size: 18),
              label: Text(
                isOrderActive(order) ? 'Track order' : 'View details',
              ),
            ),
            if (order.canRequestReturn)
              TextButton.icon(
                onPressed: () => showReturnRequest(context, state, order),
                icon: const Icon(Icons.assignment_return_outlined, size: 18),
                label: const Text('Request return'),
              ),
            if (order.aftercare.hasRecord)
              TextButton(
                onPressed: () => _openAftercare(order),
                child: const Text('Return & refund progress'),
              ),
          ],
        ),
      ],
    ),
  );

  Widget _paymentCard(OrderModel order) => CommercePanel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            CircleAvatar(
              backgroundColor: AppColors.of(context).secondaryContainer,
              child: Icon(
                Icons.receipt_long_outlined,
                color: AppColors.of(context).onSurface,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                accountMoney(order.grandTotal, order.currency),
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        StatusPill(
          paymentLabel(order.paymentStatus),
          warning: order.paymentStatus == 'pending',
          error: order.paymentStatus == 'failed',
        ),
        const SizedBox(height: 12),
        Text(
          order.paymentMethod.isEmpty
              ? 'Payment method unavailable'
              : order.paymentMethod,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 5),
        Text(
          'Order placed ${DateFormat('d MMM yyyy · h:mm a').format(order.orderDate.toLocal())}',
          style: TextStyle(
            fontSize: 11,
            color: AppColors.of(context).secondary,
          ),
        ),
        const SizedBox(height: 5),
        Text(
          'Order ${order.id}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 11),
        ),
        TextButton.icon(
          onPressed: () => _openDetails(order.id),
          icon: const Icon(Icons.receipt_outlined, size: 18),
          label: const Text('Payment details & receipt'),
        ),
      ],
    ),
  );

  Future<void> _openDetails(String id) async {
    _detailOpen = true;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: false,
      builder: (sheetContext) => FractionallySizedBox(
        heightFactor: .92,
        child: GlassPanel(
          overImage: true,
          child: AnimatedBuilder(
            animation: state,
            builder: (context, _) {
              final matches = state.orders.where((o) => o.id == id);
              if (matches.isEmpty) {
                return const Center(
                  child: Text('This order is no longer available.'),
                );
              }
              final order = matches.first;
              return ListView(
                padding: const EdgeInsets.fromLTRB(20, 18, 20, 30),
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          'Order details',
                          style: Theme.of(context).textTheme.headlineSmall,
                        ),
                      ),
                      IconButton(
                        tooltip: 'Close details',
                        onPressed: () => Navigator.pop(sheetContext),
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                  SelectableText(
                    order.id,
                    style: TextStyle(
                      fontSize: 12,
                      color: AppColors.of(context).secondary,
                    ),
                  ),
                  const SizedBox(height: 16),
                  CommercePanel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        StatusPill(
                          order.statusDisplay,
                          error: order.status == OrderStatus.cancelled,
                        ),
                        const SizedBox(height: 14),
                        if (order.status == OrderStatus.cancelled)
                          const Text(
                            'This order was cancelled. Payment and refund status are shown separately below.',
                          )
                        else ...[
                          const Text(
                            'Delivery progress',
                            style: TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 12),
                          ...List.generate(5, (i) {
                            final complete =
                                i == 0 || i - 1 <= order.statusStep;
                            const titles = [
                              'Order placed',
                              'Confirmed',
                              'Dispatched',
                              'Out for delivery',
                              'Delivered',
                            ];
                            return Padding(
                              padding: const EdgeInsets.symmetric(vertical: 9),
                              child: Row(
                                children: [
                                  Icon(
                                    complete
                                        ? Icons.check_circle
                                        : Icons.radio_button_unchecked,
                                    color: complete
                                        ? AppColors.of(context).onSurface
                                        : AppColors.of(context).outlineVariant,
                                    size: 22,
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Text(
                                      titles[i],
                                      style: TextStyle(
                                        fontWeight: complete
                                            ? FontWeight.w700
                                            : FontWeight.w400,
                                        color: complete
                                            ? AppColors.of(context).onSurface
                                            : AppColors.of(context).secondary,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            );
                          }),
                          if (isOrderActive(order))
                            Text(
                              'Delivery timing will appear when provided by the carrier.',
                              style: TextStyle(
                                fontSize: 12,
                                color: AppColors.of(context).secondary,
                              ),
                            ),
                        ],
                        if (order.trackingNumber.isNotEmpty) ...[
                          const Divider(height: 24),
                          Text(
                            'Tracking number',
                            style: TextStyle(
                              fontSize: 12,
                              color: AppColors.of(context).secondary,
                            ),
                          ),
                          Row(
                            children: [
                              Expanded(
                                child: SelectableText(order.trackingNumber),
                              ),
                              IconButton(
                                tooltip: 'Copy tracking number',
                                onPressed: () => _copy(order.trackingNumber),
                                icon: const Icon(Icons.copy_outlined, size: 19),
                              ),
                            ],
                          ),
                        ],
                        TextButton.icon(
                          onPressed: state.isLoadingHistory ? null : _refresh,
                          icon: const Icon(Icons.refresh, size: 18),
                          label: Text(
                            state.isLoadingHistory
                                ? 'Updating…'
                                : 'Refresh status',
                          ),
                        ),
                        if (state.historyError != null)
                          Text(
                            'Could not refresh. Showing the last saved status.',
                            style: TextStyle(
                              color: AppColors.of(context).error,
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  CommercePanel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Delivery address',
                          style: TextStyle(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          order.shippingAddress.isEmpty
                              ? 'Address unavailable'
                              : order.shippingAddress,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  CommercePanel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Items & totals',
                          style: TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 12),
                        ...order.items.map(
                          (item) => Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                  child: Text(
                                    '${item.quantity} × ${item.product.name}',
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Flexible(
                                  child: Text(
                                    accountMoney(
                                      order.unitPrices.length ==
                                              order.items.length
                                          ? order.unitPrices[order.items
                                                    .indexOf(item)] *
                                                item.quantity
                                          : item.subtotal,
                                      order.currency,
                                    ),
                                    textAlign: TextAlign.end,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const Divider(),
                        MoneyLine('Subtotal', order.subtotal),
                        MoneyLine('Delivery', order.deliveryFee),
                        if (order.discount > 0)
                          MoneyLine('Discount', -order.discount),
                        MoneyLine('Total', order.grandTotal, total: true),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (order.aftercare.hasRecord) ...[
                    OrderAftercarePanel(order: order),
                    TextButton(
                      onPressed: () => _openAftercare(order),
                      child: const Text('View return timeline'),
                    ),
                    const SizedBox(height: 16),
                  ],
                  if (order.canRequestReturn)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: OutlinedButton.icon(
                        onPressed: () =>
                            showReturnRequest(context, state, order),
                        icon: const Icon(Icons.assignment_return_outlined),
                        label: const Text('Request return'),
                      ),
                    ),
                  CommercePanel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Payment record',
                          style: TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 12),
                        StatusPill(
                          paymentLabel(order.paymentStatus),
                          warning: order.paymentStatus == 'pending',
                          error: order.paymentStatus == 'failed',
                        ),
                        const SizedBox(height: 12),
                        Text(order.paymentMethod),
                        if (order.transactionId.isNotEmpty) ...[
                          const SizedBox(height: 12),
                          Text(
                            'Transaction ID',
                            style: TextStyle(
                              fontSize: 11,
                              color: AppColors.of(context).secondary,
                            ),
                          ),
                          SelectableText(order.transactionId),
                          TextButton.icon(
                            onPressed: () => _copy(order.transactionId),
                            icon: const Icon(Icons.copy_outlined, size: 16),
                            label: const Text('Copy transaction ID'),
                          ),
                        ],
                        const SizedBox(height: 12),
                        OutlinedButton.icon(
                          onPressed: () => _showReceipt(context, order),
                          icon: const Icon(Icons.receipt_long_outlined),
                          label: const Text('View order receipt'),
                        ),
                      ],
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
    _detailOpen = false;
  }

  Future<void> _openAftercare(OrderModel order) async {
    await Navigator.push<void>(
      context,
      MaterialPageRoute(
        builder: (_) => ReturnDetailsScreen(state: state, order: order),
      ),
    );
    if (mounted) await _refresh();
  }

  Future<void> _copy(String value) async {
    await Clipboard.setData(ClipboardData(text: value));
    if (mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Copied to clipboard')));
    }
  }

  Future<void> _showReceipt(BuildContext context, OrderModel order) =>
      showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        showDragHandle: false,
        builder: (_) => FractionallySizedBox(
          heightFactor: .9,
          child: GlassPanel(
            overImage: true,
            child: ReceiptSheet(state: state, orderId: order.id),
          ),
        ),
      );
}
