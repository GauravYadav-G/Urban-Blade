import '../core/widgets/premium_scaffold.dart';
import 'package:flutter/material.dart';
import '../core/services/app_state.dart';
import '../core/widgets/stitch_header.dart';
import '../core/widgets/stitch_bottom_nav.dart';
import '../core/widgets/retained_tabs.dart';
import '../core/models/product_model.dart';
import 'home/home_screen.dart';
import 'services/services_screen.dart';
import 'bookings/book_flow_screen.dart';
import 'shop/shop_screen.dart';
import 'shop/product_detail_screen.dart';
import 'checkout/checkout_screen.dart';
import 'appointments/appointments_screen.dart';
import 'orders/orders_screen.dart';
import 'profile/profile_screen.dart';
import 'auth/login_screen.dart';

class MainShell extends StatefulWidget {
  final AppState state;
  final int initialTab;

  const MainShell({super.key, required this.state, this.initialTab = 0});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> with WidgetsBindingObserver {
  final _homeKey = GlobalKey<HomeScreenState>();
  final _shopKey = GlobalKey<ShopScreenState>();
  String _shopCategory = 'all';
  int _shopRequest = 0;
  final Map<int, Widget> _tabPages = {};
  bool _productDetailOpen = false;
  int _activeTab = 0; // 0: Home, 1: Services, 2: Book, 3: Shop, 4: Profile

  @override
  void initState() {
    super.initState();
    _activeTab = widget.initialTab;
    WidgetsBinding.instance.addObserver(this);
    widget.state.addListener(_onStateChange);
  }

  @override
  void didUpdateWidget(covariant MainShell oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.state != widget.state) {
      oldWidget.state.removeListener(_onStateChange);
      widget.state.addListener(_onStateChange);
      _tabPages.clear();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.state.removeListener(_onStateChange);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState lifecycle) {
    if (lifecycle == AppLifecycleState.resumed && widget.state.isLoggedIn) {
      widget.state.refreshCart();
      widget.state.loadHistory();
    }
  }

  void _onStateChange() {
    if (mounted && !_productDetailOpen) setState(() {});
  }

  void _navigateToTab(int index) {
    if (index != 3) _shopKey.currentState?.closeCart();
    setState(() => _activeTab = index);
  }

  Future<void> _openProductDetail(ProductModel product) async {
    if (_productDetailOpen) return;
    _productDetailOpen = true;
    try {
      await Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => ProductDetailScreen(
            product: product,
            heroTag: '${_activeTab == 0 ? 'home' : 'shop'}-${product.id}',
            state: widget.state,
            onBuyNow: () => _openCheckout(),
            onAdded: () {
              Navigator.pop(context);
            },
            onOpenCart: () {
              Navigator.pop(context);
              _openCart();
            },
          ),
        ),
      );
    } finally {
      // Apply changes accumulated while the catalog was covered by the detail
      // route, without rebuilding the shell during product interactions.
      _productDetailOpen = false;
      if (mounted) setState(() {});
    }
  }

  void _openCart() {
    widget.state.refreshCart();
    if (_activeTab == 0 && _homeKey.currentState != null) {
      _homeKey.currentState!.openCart();
      return;
    }
    if (_activeTab == 3 && _shopKey.currentState != null) {
      _shopKey.currentState!.openCart();
    } else {
      _navigateToTab(3);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _shopKey.currentState?.openCart();
      });
    }
  }

  Future<void> _openCheckout() async {
    if (widget.state.cart.isEmpty && widget.state.pendingPayment == null) {
      return;
    }
    if (!widget.state.isLoggedIn) {
      await Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => LoginScreen(
            state: widget.state,
            onLoginSuccess: () => Navigator.pop(context),
          ),
        ),
      );
      if (!mounted || !widget.state.isLoggedIn) return;
    }
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => CheckoutScreen(
          state: widget.state,
          onOrderPlaced: () {
            Navigator.of(context).popUntil((route) => route.isFirst);
            _navigateToTab(4);
            _openOrders();
          },
        ),
      ),
    );
  }

  Future<void> _openAppointments() async {
    widget.state.loadHistory();
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => AppointmentsScreen(
          state: widget.state,
          onBookNew: () {
            Navigator.pop(context);
            _navigateToTab(2);
          },
        ),
      ),
    );
  }

  Future<void> _openOrders({
    bool payments = false,
    bool returns = false,
  }) async {
    widget.state.loadHistory();
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => OrdersScreen(
          showPayments: payments,
          showReturns: returns,
          state: widget.state,
          onShopNew: () {
            Navigator.pop(context);
            _navigateToTab(3);
          },
        ),
      ),
    );
  }

  void _openLogin() {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => LoginScreen(
          state: widget.state,
          onLoginSuccess: () => Navigator.pop(context),
        ),
      ),
    );
  }

  void _showShop(String category) {
    setState(() {
      _shopCategory = category;
      _shopRequest++;
      _tabPages.remove(3);
      _activeTab = 3;
    });
  }

  Widget _tabPage(int index) => _tabPages.putIfAbsent(
    index,
    () => switch (index) {
      0 => HomeScreen(
        key: _homeKey,
        state: widget.state,
        onCheckout: _openCheckout,
        onNavigateToServices: () => _navigateToTab(1),
        onNavigateToBook: () => _navigateToTab(2),
        onNavigateToShop: () => _showShop('all'),
        onCategorySelected: _showShop,
        onSelectProduct: _openProductDetail,
      ),
      1 => ServicesScreen(
        state: widget.state,
        onProceedToBooking: () => _navigateToTab(2),
      ),
      2 => BookFlowScreen(
        state: widget.state,
        onBookingComplete: () => _navigateToTab(0),
      ),
      3 => ShopScreen(
        key: _shopKey,
        state: widget.state,
        initialCategory: _shopCategory,
        request: _shopRequest,
        onCheckout: _openCheckout,
        onProductSelected: _openProductDetail,
        onOpenCart: _openCart,
      ),
      _ => ProfileScreen(
        state: widget.state,
        onOpenAppointments: _openAppointments,
        onOpenOrders: _openOrders,
        onOpenPayments: () => _openOrders(payments: true),
        onOpenReturns: () => _openOrders(returns: true),
        onOpenLogin: _openLogin,
      ),
    },
  );

  String _getHeaderTitle() {
    switch (_activeTab) {
      case 0:
        return 'Urban Blade';
      case 1:
        return 'Grooming Services';
      case 2:
        return 'Book an appointment';
      case 3:
        return 'The care collection';
      case 4:
        return 'My account';
      default:
        return 'Urban Blade';
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    final statusMessages = <Widget>[
      if (state.syncError != null && _activeTab == 4)
        MaterialBanner(
          content: Text(state.syncError!),
          actions: [
            TextButton(
              onPressed: state.syncCart,
              child: const Text('Retry sync'),
            ),
          ],
        ),
      if (state.pendingPayment != null)
        MaterialBanner(
          content: const Text('You have an unfinished payment.'),
          actions: [
            TextButton(
              onPressed: _openCheckout,
              child: const Text('Check status'),
            ),
          ],
        ),
      if (state.historyError != null)
        MaterialBanner(
          content: Text(state.historyError!),
          actions: [
            TextButton(
              onPressed: state.loadHistory,
              child: const Text('Retry'),
            ),
          ],
        ),
      if (state.catalogError != null)
        MaterialBanner(
          content: Text(state.catalogError!),
          actions: [
            TextButton(
              onPressed: state.loadRemoteData,
              child: const Text('Retry'),
            ),
          ],
        ),
    ];
    final navigation = StitchBottomNav(
      dark: Theme.of(context).brightness == Brightness.dark,
      currentIndex: _activeTab,
      onTap: _navigateToTab,
      cartItemCount: state.cartCount,
    );

    return PopScope(
      canPop: _activeTab == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        if (_activeTab != 0) _navigateToTab(0);
      },
      child: PremiumScaffold(
        backgroundColor: Colors.transparent,
        extendBody: false,
        appBar: StitchHeader(
          dark: Theme.of(context).brightness == Brightness.dark,
          state: state,
          onProfile: () => _navigateToTab(4),
          onCart: _openCart,
          title: _activeTab == 0 ? null : _getHeaderTitle(),
        ),
        body: SafeArea(
          top: false,
          bottom: false,
          child: LayoutBuilder(
            builder: (context, constraints) => Column(
              children: [
                if (state.isRestoringSession)
                  const LinearProgressIndicator(minHeight: 2),
                if (statusMessages.isNotEmpty)
                  ConstrainedBox(
                    constraints: BoxConstraints(
                      maxHeight: constraints.maxHeight * .45,
                    ),
                    child: SingleChildScrollView(
                      child: Column(children: statusMessages),
                    ),
                  ),
                if (state.isLoadingFromDb)
                  const LinearProgressIndicator(minHeight: 2),
                Expanded(
                  child: RetainedTabs(
                    index: _activeTab,
                    builders: List.generate(
                      5,
                      (index) =>
                          (_) => _tabPage(index),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        bottomNavigationBar: MediaQuery.viewInsetsOf(context).bottom > 0
            ? null
            : navigation,
      ),
    );
  }
}
