import '../../core/widgets/entrance.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import '../../core/services/app_state.dart';
import '../../core/constants/app_colors.dart';
import '../../core/models/product_model.dart';
import '../../core/widgets/stitch_image.dart';
import '../../core/widgets/product_card.dart';
import '../../core/widgets/glass_panel.dart';
import '../cart/cart_flow.dart';
import '../cart/cart_sheet_host.dart';
import 'home_editorial_cards.dart';
import 'ritual_dashboard.dart';

class HomeScreen extends StatefulWidget {
  final AppState state;
  final VoidCallback onNavigateToServices, onNavigateToBook, onNavigateToShop;
  final VoidCallback? onCheckout;
  final Function(ProductModel) onSelectProduct;
  final ValueChanged<String>? onCategorySelected;
  const HomeScreen({
    super.key,
    required this.state,
    required this.onNavigateToServices,
    required this.onNavigateToBook,
    required this.onNavigateToShop,
    required this.onSelectProduct,
    this.onCategorySelected,
    this.onCheckout,
  });

  @override
  State<HomeScreen> createState() => HomeScreenState();
}

class HomeScreenState extends State<HomeScreen> {
  final _cartFlow = GlobalKey<CartFlowState>();
  final _cartSheet = GlobalKey<CartSheetHostState>();
  bool get _dark => Theme.of(context).brightness == Brightness.dark;
  Color get _foreground => AppColors.of(context).onSurface;
  Color get _muted => AppColors.of(context).secondary;

  Future<void> openCart() async => _cartSheet.currentState?.open();

  Object? _homeData;
  Set<String> _saved = {};
  Object get _currentData => (
    widget.state.products,
    widget.state.services,
    widget.state.isLoggedIn,
    widget.state.userName,
    widget.state.pendingPayment != null,
    widget.state.isLoadingFromDb,
  );

  void _rememberData() {
    _homeData = _currentData;
    _saved = Set.of(widget.state.wishlist);
  }

  void _homeChanged() {
    if (_homeData != _currentData ||
        !setEquals(_saved, widget.state.wishlist)) {
      setState(_rememberData);
    }
  }

  @override
  void initState() {
    super.initState();
    _rememberData();
    widget.state.addListener(_homeChanged);
  }

  @override
  void didUpdateWidget(covariant HomeScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.state != widget.state) {
      oldWidget.state.removeListener(_homeChanged);
      widget.state.addListener(_homeChanged);
      _rememberData();
    }
  }

  @override
  void dispose() {
    widget.state.removeListener(_homeChanged);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => CartSheetHost(
    key: _cartSheet,
    state: widget.state,
    surfaceKey: const ValueKey('home-cart-surface'),
    onCheckout: widget.onCheckout ?? widget.onNavigateToShop,
    child: CartFlow(
      key: _cartFlow,
      state: widget.state,
      onCheckout: widget.onCheckout ?? widget.onNavigateToShop,
      onOpenCart: openCart,
      showEmptyDock: false,
      catalogColor: Colors.transparent,
      child: ColoredBox(
        color: Colors.transparent,
        child: RefreshIndicator(
          color: Theme.of(context).colorScheme.primary,
          backgroundColor: Theme.of(context).colorScheme.surfaceContainerLow,
          onRefresh: widget.state.loadRemoteData,
          child: CustomScrollView(
            key: const PageStorageKey('home-scroll'),
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                sliver: EntranceSliver(
                  order: 0,
                  child: RitualDashboard(
                    greeting:
                        widget.state.isLoggedIn &&
                            widget.state.userName.trim().isNotEmpty
                        ? 'Good to see you, ${widget.state.userName.trim().split(' ').first}.'
                        : 'Good to see you.',
                    onServices: widget.onNavigateToServices,
                    onStudio: () => _book('studio'),
                    onHome: () => _book('home'),
                    onBook: widget.onNavigateToBook,
                  ),
                ),
              ),
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 18, 20, 10),
                sliver: SliverToBoxAdapter(
                  child: _heading(
                    'Your daily essentials',
                    widget.onNavigateToShop,
                  ),
                ),
              ),
              if (widget.state.products.isEmpty)
                SliverPadding(
                  padding: const EdgeInsets.all(20),
                  sliver: EntranceSliver(
                    order: 4,
                    child: Text(
                      widget.state.isLoadingFromDb
                          ? 'Finding your essentials…'
                          : 'Products are unavailable right now. Pull down to refresh.',
                      style: TextStyle(color: _muted),
                    ),
                  ),
                ),
              SliverPadding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                sliver: SliverLayoutBuilder(
                  builder: (context, constraints) {
                    final columns =
                        constraints.crossAxisExtent < 310 ||
                            MediaQuery.textScalerOf(context).scale(14) > 21
                        ? 1
                        : constraints.crossAxisExtent >= 600
                        ? 3
                        : 2;
                    final products = widget.state.products.take(4).toList();
                    return SliverList.separated(
                      itemCount: (products.length / columns).ceil(),
                      separatorBuilder: (_, __) => const SizedBox(height: 14),
                      itemBuilder: (context, row) => Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: List.generate(columns, (column) {
                          final index = row * columns + column;
                          return Expanded(
                            child: Padding(
                              padding: EdgeInsets.only(
                                left: column == 0 ? 0 : 6,
                                right: column == columns - 1 ? 0 : 6,
                              ),
                              child: index >= products.length
                                  ? const SizedBox()
                                  : _product(products[index]),
                            ),
                          );
                        }),
                      ),
                    );
                  },
                ),
              ),
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 26, 20, 0),
                sliver: EntranceSliver(
                  order: 4,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _heading('Explore your ritual', widget.onNavigateToShop),
                      const SizedBox(height: 14),
                      RitualCategories(
                        state: widget.state,
                        onSelected: (category) {
                          if (widget.onCategorySelected != null) {
                            widget.onCategorySelected!(category);
                          } else {
                            widget.onNavigateToShop();
                          }
                        },
                      ),
                      const SizedBox(height: 14),
                      const SizedBox(height: 26),
                      _heading(
                        'Time for yourself',
                        widget.onNavigateToServices,
                      ),
                      const SizedBox(height: 12),
                    ],
                  ),
                ),
              ),
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
                sliver: SliverList.separated(
                  itemCount: widget.state.services.take(3).length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (_, index) {
                    final service = widget.state.services[index];
                    return GlassPanel(
                      radius: 20,
                      child: ListTile(
                        contentPadding: const EdgeInsets.all(12),
                        leading: StitchImage(
                          imageUrl: service.imageUrl,
                          width: 54,
                          height: 60,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        title: Text(
                          service.name,
                          style: TextStyle(
                            color: _foreground,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        subtitle: Text(
                          '${service.duration} · ₹${service.price}',
                          style: TextStyle(color: _muted, fontSize: 12),
                        ),
                        trailing: Icon(
                          Icons.chevron_right,
                          color: _muted,
                          size: 20,
                        ),
                        onTap: () {
                          if (!widget.state.selectedServiceIds.contains(
                            service.id,
                          )) {
                            widget.state.toggleServiceSelection(service.id);
                          }
                          widget.onNavigateToBook();
                        },
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );

  void _book(String mode) {
    widget.state.setLocationMode(mode);
    widget.onNavigateToBook();
  }

  Widget _heading(String text, VoidCallback action) => Row(
    children: [
      Expanded(
        child: Text(
          text,
          style: TextStyle(
            color: _foreground,
            fontSize: 20,
            fontWeight: FontWeight.w600,
            letterSpacing: -.5,
          ),
        ),
      ),
      IconButton(
        tooltip: 'See all $text',
        onPressed: action,
        icon: Icon(Icons.arrow_forward, color: _foreground, size: 21),
      ),
    ],
  );

  Widget _product(ProductModel product) => ProductCard(
    product: product,
    motionOrder: widget.state.products.indexOf(product) % 4,
    dark: _dark,
    heroTag: 'home-${product.id}',
    saved: widget.state.wishlist.contains(product.id),
    onOpen: () => widget.onSelectProduct(product),
    onSave: () => widget.state.toggleWishlist(product.id),
    onAddFrom: !product.inStock || widget.state.pendingPayment != null
        ? null
        : (origin) => _cartFlow.currentState?.add(product, origin),
  );
}
