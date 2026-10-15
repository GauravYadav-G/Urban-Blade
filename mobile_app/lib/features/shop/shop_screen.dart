import '../../core/widgets/entrance.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import '../../core/services/app_state.dart';
import '../../core/constants/app_colors.dart';
import '../../core/models/product_model.dart';
import '../../core/widgets/product_card.dart';
import '../../core/widgets/glass_panel.dart';
import '../cart/cart_flow.dart';
import '../cart/cart_sheet_host.dart';

class ShopScreen extends StatefulWidget {
  final AppState state;
  final String initialCategory;
  final int request;
  final Function(ProductModel) onProductSelected;
  final VoidCallback onOpenCart;
  final VoidCallback? onCheckout;
  const ShopScreen(
      {super.key,
      required this.state,
      this.initialCategory = 'all',
      this.request = 0,
      required this.onProductSelected,
      required this.onOpenCart,
      this.onCheckout});
  @override
  State<ShopScreen> createState() => ShopScreenState();
}

class ShopScreenState extends State<ShopScreen> {
  final _cartFlow = GlobalKey<CartFlowState>();
  final _cartSheet = GlobalKey<CartSheetHostState>();
  void openCart() => _cartSheet.currentState?.open();
  void closeCart() => _cartSheet.currentState?.close();
  String _query = '', _category = 'all', _sort = 'Featured';
  bool _savedOnly = false;
  final _search = TextEditingController();
  List<ProductModel> _source = [], _products = [];
  List<String> _categories = [];
  Set<String> _saved = {};
  bool _paymentBlocked = false;
  void _updateView(VoidCallback change) => setState(() {
        change();
        _computeCatalog();
      });
  void _catalogChanged() {
    final state = widget.state;
    if (!identical(_source, state.products) ||
        !setEquals(_saved, state.wishlist) ||
        _paymentBlocked != (state.pendingPayment != null)) {
      setState(_computeCatalog);
    }
  }

  void _computeCatalog() {
    final s = widget.state;
    _source = s.products;
    _saved = Set.of(s.wishlist);
    _paymentBlocked = s.pendingPayment != null;
    _categories = ['all', ...s.products.map((p) => p.category).toSet()];
    final cleanQuery = _query.trim().toLowerCase();
    _products = s.products
        .where((p) =>
            (_category == 'all' || p.category == _category) &&
            (!_savedOnly || _saved.contains(p.id)) &&
            (cleanQuery.isEmpty ||
                '${p.name} ${p.category}'.toLowerCase().contains(cleanQuery)))
        .toList();
    if (_sort == 'Price: low to high') {
      _products.sort((a, b) => a.price.compareTo(b.price));
    } else if (_sort == 'Price: high to low') {
      _products.sort((a, b) => b.price.compareTo(a.price));
    }
  }

  @override
  void initState() {
    super.initState();
    _category = widget.initialCategory;
    _computeCatalog();
    widget.state.addListener(_catalogChanged);
  }

  @override
  void didUpdateWidget(covariant ShopScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.state != widget.state) {
      oldWidget.state.removeListener(_catalogChanged);
      widget.state.addListener(_catalogChanged);
      _computeCatalog();
    }
    if (oldWidget.request != widget.request ||
        oldWidget.initialCategory != widget.initialCategory) {
      _category = widget.initialCategory;
      _query = '';
      _search.clear();
      _savedOnly = false;
      _computeCatalog();
    }
  }

  @override
  void dispose() {
    widget.state.removeListener(_catalogChanged);
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.state;
    final categories = _categories;
    final products = _products;
    final catalog = RefreshIndicator(
        onRefresh: s.loadRemoteData,
        child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverPadding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
                  sliver: EntranceSliver(
                      order: 0,
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Daily care, upgraded.',
                                style: Theme.of(context)
                                    .textTheme
                                    .headlineMedium
                                    ?.copyWith(
                                        fontFamily: 'CormorantGaramond',
                                        fontSize: 34,
                                        height: 1.06,
                                        fontWeight: FontWeight.w600)),
                            const SizedBox(height: 18),
                            GlassPanel(
                                radius: 18,
                                child: TextField(
                                    controller: _search,
                                    onChanged: (value) =>
                                        _updateView(() => _query = value),
                                    decoration: InputDecoration(
                                        hintText: 'Search grooming essentials',
                                        prefixIcon: const Icon(Icons.search),
                                        suffixIcon: _query.isEmpty
                                            ? null
                                            : IconButton(
                                                tooltip: 'Clear search',
                                                onPressed: () {
                                                  _search.clear();
                                                  _updateView(
                                                      () => _query = '');
                                                },
                                                icon:
                                                    const Icon(Icons.close))))),
                            const SizedBox(height: 16),
                            SizedBox(
                                height: 44 +
                                    (MediaQuery.textScalerOf(context).scale(12) - 12) *
                                        2,
                                child: ListView.separated(
                                    scrollDirection: Axis.horizontal,
                                    itemCount: categories.length,
                                    separatorBuilder: (_, __) =>
                                        const SizedBox(width: 8),
                                    itemBuilder: (_, i) => ChoiceChip(
                                        labelStyle: TextStyle(
                                            fontFamily: 'PlusJakartaSans',
                                            color: _category == categories[i]
                                                ? Theme.of(context)
                                                    .colorScheme
                                                    .onSecondaryContainer
                                                : AppColors.of(context)
                                                    .secondary),
                                        label: Text(categories[i] == 'all'
                                            ? 'All products'
                                            : (categories[i].isEmpty
                                                ? 'Other'
                                                : '${categories[i][0].toUpperCase()}${categories[i].substring(1)}')),
                                        selected: _category == categories[i],
                                        onSelected: (_) =>
                                            _updateView(() => _category = categories[i])))),
                            const SizedBox(height: 10),
                            Wrap(
                                spacing: 12,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: [
                                  Text('${products.length} essentials',
                                      style: TextStyle(
                                          fontSize: 12,
                                          color:
                                              AppColors.of(context).secondary)),
                                  FilterChip(
                                      labelStyle: TextStyle(
                                          fontFamily: 'PlusJakartaSans',
                                          color: _savedOnly
                                              ? Theme.of(context)
                                                  .colorScheme
                                                  .onSecondaryContainer
                                              : AppColors.of(context)
                                                  .secondary),
                                      label: const Text('Saved'),
                                      selected: _savedOnly,
                                      avatar: const Icon(Icons.favorite_border,
                                          size: 16),
                                      onSelected: (value) => _updateView(
                                          () => _savedOnly = value)),
                                  PopupMenuButton<String>(
                                      tooltip: 'Sort products',
                                      initialValue: _sort,
                                      onSelected: (value) =>
                                          _updateView(() => _sort = value),
                                      itemBuilder: (_) => [
                                            'Featured',
                                            'Price: low to high',
                                            'Price: high to low'
                                          ]
                                              .map((value) => PopupMenuItem(
                                                  value: value,
                                                  child: Text(value)))
                                              .toList(),
                                      child: Padding(
                                          padding: const EdgeInsets.symmetric(
                                              vertical: 14),
                                          child: Wrap(
                                              spacing: 4,
                                              crossAxisAlignment:
                                                  WrapCrossAlignment.center,
                                              children: [
                                                Text(_sort,
                                                    style: const TextStyle(
                                                        fontSize: 12)),
                                                const Icon(Icons.expand_more,
                                                    size: 18)
                                              ]))),
                                ]),
                          ]))),
              if (products.isEmpty)
                const SliverFillRemaining(
                    hasScrollBody: false,
                    child: Center(
                        child:
                            Text('No products here yet. Try another search.'))),
              SliverPadding(
                  padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
                  sliver: SliverLayoutBuilder(builder: (context, constraints) {
                    final columns = constraints.crossAxisExtent >= 600
                        ? 3
                        : (constraints.crossAxisExtent < 290 ||
                                MediaQuery.textScalerOf(context).scale(14) > 21
                            ? 1
                            : 2);
                    return SliverList.separated(
                        itemCount: (products.length / columns).ceil(),
                        separatorBuilder: (_, __) => const SizedBox(height: 14),
                        itemBuilder: (_, row) => Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: List.generate(columns, (column) {
                              final index = row * columns + column;
                              return Expanded(
                                  child: Padding(
                                      padding: EdgeInsets.only(
                                          left: column == 0 ? 0 : 7,
                                          right: column == columns - 1 ? 0 : 7),
                                      child: index >= products.length
                                          ? const SizedBox()
                                          : ProductCard(
                                              product: products[index],
                                              motionOrder: index % 4,
                                              heroTag:
                                                  'shop-${products[index].id}',
                                              saved: s.wishlist
                                                  .contains(products[index].id),
                                              onOpen: () =>
                                                  widget.onProductSelected(
                                                      products[index]),
                                              onSave: () => _updateView(() =>
                                                  s.toggleWishlist(
                                                      products[index].id)),
                                              onAddFrom: !products[index].inStock ||
                                                      s.pendingPayment != null
                                                  ? null
                                                  : (origin) =>
                                                      _cartFlow.currentState?.add(products[index], origin))));
                            })));
                  })),
            ]));
    return CartSheetHost(
        key: _cartSheet,
        surfaceKey: const ValueKey('shop-cart-surface'),
        state: s,
        onCheckout: widget.onCheckout ?? widget.onOpenCart,
        child: CartFlow(
            key: _cartFlow,
            state: s,
            onCheckout: widget.onCheckout ?? widget.onOpenCart,
            onOpenCart: openCart,
            catalogColor: Colors.transparent,
            child: catalog));
  }
}
