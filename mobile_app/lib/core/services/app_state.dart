import 'package:flutter/material.dart';
import 'dart:convert';
import 'dart:async';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:intl/intl.dart';
import '../models/service_model.dart';
import '../models/product_model.dart';
import '../models/barber_model.dart';
import '../models/booking_model.dart';
import '../models/order_model.dart';
import '../models/address_model.dart';
import '../models/order_return_model.dart';
import '../constants/salon_constants.dart';
import 'api_service.dart';

class AppState extends ChangeNotifier {
  final ApiService api;
  bool isLoadingFromDb = false;
  ThemeMode themeMode = ThemeMode.light;
  int _appearanceRevision = 0;
  Future<void> _appearanceWrites = Future.value();

  Future<void> restoreAppearance() async {
    final revision = _appearanceRevision;
    final prefs = await SharedPreferences.getInstance();
    if (_disposed || revision != _appearanceRevision) return;
    final saved = prefs.getString('urban_appearance');
    themeMode = ThemeMode.values.firstWhere(
      (mode) => mode.name == saved,
      orElse: () => ThemeMode.light,
    );
    notifyListeners();
  }

  Future<void> setThemeMode(ThemeMode mode) {
    _appearanceRevision++;
    themeMode = mode;
    notifyListeners();
    final write = _appearanceWrites.then((_) async {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('urban_appearance', mode.name);
    });
    _appearanceWrites = write.catchError((Object _) {});
    return write;
  }

  bool isRestoringSession = false;
  bool isSyncingCart = false;
  String? syncError;
  bool _disposed = false;
  String _draftOwner = 'guest';
  bool _cartDirty = false;
  int _cartRevision = 0;
  int _accountRevision = 0;
  bool _loggingOut = false;
  Timer? _cartTimer;
  Future<void>? _syncing;
  Future<void> _persistQueue = Future.value();
  Map<String, dynamic>? pendingPayment;
  Map<String, dynamic>? checkoutQuote;
  String deliveryName = '', deliveryPhone = '';

  AppState({ApiService? api, bool autoLoad = true})
    : api = api ?? ApiService() {
    this.api.onSessionExpired = _sessionExpired;
    if (autoLoad) unawaited(initialize());
  }
  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _cartTimer?.cancel();
    api.onSessionExpired = null;
    super.dispose();
  }

  Future<void> initialize() async {
    final revision = _accountRevision;
    isRestoringSession = true;
    notifyListeners();
    // Catalog is public and must not wait for authentication or account history.
    final catalog = loadRemoteData();
    try {
      await restoreAppearance();
      final user = await api.restoreSession();
      if (_disposed || revision != _accountRevision) return;
      if (user != null) {
        _setUser(user);
        _draftOwner = api.currentUserId ?? 'guest';
      }
      await _restoreDraft();
      if (isLoggedIn) {
        unawaited(loadHistory());
        unawaited(loadAddresses());
        unawaited(refreshCart());
      }
    } catch (e) {
      syncError = e.toString();
    } finally {
      isRestoringSession = false;
      notifyListeners();
    }
    await catalog;
  }

  Future<void> loadRemoteData({bool forceRefresh = false}) async {
    if (isLoadingFromDb) return;
    if (forceRefresh) api.clearCatalogCache();
    catalogError = null;
    isLoadingFromDb = true;
    notifyListeners();
    final errors = <String>[];
    await Future.wait([
      (() async {
        try {
          _products = await api.fetchProducts();
        } catch (e) {
          errors.add(e.toString());
        }
      })(),
      (() async {
        try {
          _services = await api.fetchServices();
        } catch (e) {
          errors.add(e.toString());
        }
      })(),
      (() async {
        try {
          _barbers = await api.fetchStylists();
          if (_barbers.isNotEmpty &&
              !_barbers.any((b) => b.id == _selectedBarber.id)) {
            _selectedBarber = _barbers.first;
          }
        } catch (e) {
          errors.add(e.toString());
        }
      })(),
    ]);
    catalogError = errors.isEmpty ? null : errors.first;
    isLoadingFromDb = false;
    notifyListeners();
  }

  Future<void> _restoreDraft() async {
    final owner = _draftOwner;
    final revision = _cartRevision;
    final prefs = await SharedPreferences.getInstance();
    if (_disposed || owner != _draftOwner || revision != _cartRevision) return;
    try {
      final data =
          jsonDecode(prefs.getString('urban_draft_$owner') ?? '{}') as Map;
      _cart
        ..clear()
        ..addAll(
          (data['cart'] as List? ?? []).map(
            (i) => CartItem.fromJson(Map<String, dynamic>.from(i)),
          ),
        );
      _cartDirty = data['dirty'] == true;
      _homeAddress = data['street'] ?? '';
      city = data['city'] ?? '';
      region = data['region'] ?? '';
      postalCode = data['postalCode'] ?? '';
      deliveryName = data['deliveryName'] ?? '';
      deliveryPhone = data['deliveryPhone'] ?? '';
      selectedDeliveryAddressId = data['selectedAddressId'] as String?;
      _wishlist
        ..clear()
        ..addAll(List<String>.from(data['wishlist'] ?? []));
      _checkoutKeys
        ..clear()
        ..addAll(Map<String, String>.from(data['checkoutKeys'] ?? {}));
      pendingPayment = data['payment'] == null
          ? null
          : Map<String, dynamic>.from(data['payment']);
    } catch (_) {
      syncError = 'Saved draft could not be restored. Please review your cart.';
    }
    notifyListeners();
  }

  Future<void> persistDraft() {
    final owner = _draftOwner;
    final data = jsonEncode({
      'cart': _cart.map((i) => i.toJson()).toList(),
      'dirty': _cartDirty,
      'street': _homeAddress,
      'city': city,
      'region': region,
      'postalCode': postalCode,
      'deliveryName': deliveryName,
      'deliveryPhone': deliveryPhone,
      'selectedAddressId': selectedDeliveryAddressId,
      'wishlist': _wishlist.toList(),
      'checkoutKeys': _checkoutKeys,
      'payment': pendingPayment,
    });
    _persistQueue = _persistQueue.catchError((_) {}).then((_) async {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('urban_draft_$owner', data);
    });
    return _persistQueue;
  }

  void _cartChanged() {
    _cartDirty = true;
    _cartRevision++;
    checkoutQuote = null;
    reviewedTotal = null;
    unawaited(persistDraft());
    _cartTimer?.cancel();
    if (isLoggedIn) {
      _cartTimer = Timer(
        const Duration(milliseconds: 450),
        () => unawaited(syncCart()),
      );
    }
    notifyListeners();
  }

  List<Map<String, dynamic>> _websiteCart() => _cart
      .map(
        (i) => {
          'lineId': i.product.id,
          'productId': i.product.id,
          'name': i.product.name,
          'imageUrl': i.product.imageUrl,
          'unitPrice': i.product.price,
          'currency': 'INR',
          'qty': i.quantity,
          'kind': 'retail',
          'description': i.product.description,
        },
      )
      .toList();

  Future<void> syncCart() async {
    if (_syncing != null) return _syncing;
    if (!isLoggedIn || !_cartDirty) return;
    _syncing = _flushCart();
    try {
      await _syncing;
    } finally {
      _syncing = null;
    }
  }

  Future<void> _flushCart() async {
    isSyncingCart = true;
    syncError = null;
    notifyListeners();
    final owner = _draftOwner;
    try {
      while (_cartDirty && isLoggedIn && owner == _draftOwner) {
        final revision = _cartRevision;
        await api.saveCart(_websiteCart());
        if (owner != _draftOwner) return;
        if (revision == _cartRevision) _cartDirty = false;
        await persistDraft();
      }
    } catch (e) {
      syncError = 'Cart saved on this device. ${e.toString()}';
    } finally {
      isSyncingCart = false;
      notifyListeners();
    }
  }

  Future<void> refreshCart({List<CartItem> guestItems = const []}) async {
    if (!isLoggedIn || pendingPayment != null) return;
    if (_cartDirty && guestItems.isEmpty) {
      await syncCart();
      return;
    }
    final owner = _draftOwner;
    final revision = _cartRevision;
    try {
      final remote = await api.fetchCart();
      if (owner != _draftOwner || revision != _cartRevision) return;
      final merged = <String, CartItem>{};
      for (final row in remote) {
        final item = CartItem(
          product: ProductModel.fromJson({
            'id': row['productId'],
            'name': row['name'],
            'price': num.tryParse('${row['unitPrice']}')?.round() ?? 0,
            'imageUrl': row['imageUrl'] ?? '',
            'description': row['description'] ?? '',
          }),
          quantity: (num.tryParse('${row['qty']}')?.toInt() ?? 1).clamp(1, 100),
        );
        merged[item.product.id] = item;
      }
      for (final item in [
        ...(_cartDirty ? _cart : <CartItem>[]),
        ...guestItems,
      ]) {
        final prior = merged[item.product.id];
        merged[item.product.id] = CartItem(
          product: item.product,
          quantity:
              (prior == null
                      ? item.quantity
                      : (prior.quantity > item.quantity
                            ? prior.quantity
                            : item.quantity))
                  .clamp(1, 100),
        );
      }
      _cart
        ..clear()
        ..addAll(merged.values);
      checkoutQuote = null;
      if (guestItems.isNotEmpty) {
        _cartChanged();
        await syncCart();
      } else {
        await persistDraft();
        notifyListeners();
      }
      syncError = null;
    } catch (e) {
      syncError = 'Could not refresh your cart. ${e.toString()}';
      notifyListeners();
    }
  }

  Future<void> saveDelivery({
    required String name,
    required String phone,
    required String street,
    required String newCity,
    required String newRegion,
    required String pin,
  }) async {
    selectedDeliveryAddressId = null;
    deliveryName = name;
    deliveryPhone = phone;
    _homeAddress = street;
    city = newCity;
    region = newRegion;
    postalCode = pin;
    await persistDraft();
    notifyListeners();
  }

  Future<void> updateProfile(String name, String phone) async {
    final revision = _accountRevision;
    final user = await api.updateProfile(name, phone);
    if (_disposed || revision != _accountRevision || !isLoggedIn) return;
    _setUser(user);
    notifyListeners();
  }

  void _sessionExpired() {
    if (_loggingOut) return;
    _accountRevision++;
    _cartTimer?.cancel();
    unawaited(persistDraft());
    isLoggedIn = false;
    userName = 'Guest';
    userEmail = '';
    userPhone = '';
    _bookings.clear();
    _orders.clear();
    _addresses = const [];
    _addressDataRevision++;
    isLoadingAddresses = false;
    isSavingAddress = false;
    isLoadingHistory = false;
    addressesError = null;
    requestingReturnId = null;
    selectedDeliveryAddressId = null;
    _cart.clear();
    _wishlist.clear();
    _homeAddress = '';
    city = '';
    region = '';
    postalCode = '';
    deliveryName = '';
    deliveryPhone = '';
    pendingPayment = null;
    _checkoutKeys.clear();
    checkoutQuote = null;
    reviewedTotal = null;
    _appliedPromo = null;
    _promoDiscount = 0;
    _cartDirty = false;
    _cartRevision++;
    _draftOwner = 'guest';
    historyError = null;
    syncError = 'Please sign in again to sync your account.';
    notifyListeners();
  }

  // Location selection: 'studio' | 'home'
  String _locationMode = 'studio';
  String get locationMode => _locationMode;
  bool get isStudioMode => _locationMode == 'studio';

  String _currentStudio = SalonConstants.studioAddress;
  String get currentStudio => _currentStudio;

  String _homeAddress = '';
  String city = '', region = '', postalCode = '';
  String? catalogError;
  String get homeAddress => _homeAddress;

  void setLocationMode(String mode) {
    _locationMode = mode;
    notifyListeners();
  }

  void setStudio(String studio) {
    _currentStudio = studio;
    notifyListeners();
  }

  void setHomeAddress(String address) {
    _homeAddress = address;
    unawaited(persistDraft());
    notifyListeners();
  }

  // Catalog & Services
  List<ServiceModel> _services = [];
  List<ServiceModel> get services => _services;

  List<ProductModel> _products = [];
  List<ProductModel> get products => _products;

  List<BarberModel> _barbers = [];
  List<BarberModel> get barbers => _barbers;

  // Selected Services for Booking
  final Set<String> _selectedServiceIds = {};
  Set<String> get selectedServiceIds => _selectedServiceIds;

  void toggleServiceSelection(String serviceId) {
    if (_selectedServiceIds.contains(serviceId)) {
      _selectedServiceIds.remove(serviceId);
    } else {
      _selectedServiceIds.clear();
      _selectedServiceIds.add(serviceId);
    }
    notifyListeners();
  }

  List<ServiceModel> get selectedServices {
    return _services.where((s) => _selectedServiceIds.contains(s.id)).toList();
  }

  int get selectedServicesPrice {
    var sum = 0;
    for (final s in _services) {
      if (_selectedServiceIds.contains(s.id)) {
        sum += s.price;
      }
    }
    return sum;
  }

  // Booking Draft
  BarberModel _selectedBarber = const BarberModel(
    id: '',
    name: 'Assigned by salon',
    title: '',
    rating: 0,
    reviewsCount: 0,
    avatarUrl: '',
    experience: '',
    bio: '',
  );
  BarberModel get selectedBarber => _selectedBarber;
  void setSelectedBarber(BarberModel barber) {
    _selectedBarber = barber;
    notifyListeners();
  }

  String _selectedDate = DateFormat(
    'yyyy-MM-dd',
  ).format(DateTime.now().add(const Duration(days: 1)));
  String get selectedDate => _selectedDate;
  void setSelectedDate(String date) {
    _selectedDate = date;
    notifyListeners();
  }

  String _selectedTimeSlot = '';
  String get selectedTimeSlot => _selectedTimeSlot;
  void setSelectedTimeSlot(String time) {
    _selectedTimeSlot = time;
    notifyListeners();
  }

  // Promo Code
  String? _appliedPromo;
  String? get appliedPromo => _appliedPromo;
  int _promoDiscount = 0;
  int get promoDiscount => _promoDiscount;

  Future<bool> applyPromo(String code) async {
    final upper = code.trim().toUpperCase();
    if (upper.isEmpty || _cart.isEmpty) return false;
    final quote = await api.quoteOrder(
      items: _buildCartApiItems(),
      couponCode: upper,
    );
    if (quote == null) return false;
    _appliedPromo = upper;
    _promoDiscount = (quote['discountAmount'] as num?)?.round() ?? 0;
    notifyListeners();
    return true;
  }

  void removePromo() {
    _appliedPromo = null;
    _promoDiscount = 0;
    notifyListeners();
  }

  // Bookings list
  final List<BookingModel> _bookings = [];
  List<BookingModel> get bookings => _bookings;

  Future<BookingModel> createBooking({
    ServiceModel? service,
    BarberModel? barber,
    String? locationType,
    String? address,
    String? date,
    String? timeSlot,
  }) async {
    if (!isLoggedIn) throw Exception('Please sign in to book.');
    final revision = _accountRevision;
    final owner = _draftOwner;
    final chosenService =
        service ?? (selectedServices.isEmpty ? null : selectedServices.first);
    final chosenLoc = locationType ?? _locationMode;
    final chosenAddress =
        address ?? (chosenLoc == 'home' ? _homeAddress : currentStudio);
    final chosenDate = date ?? _selectedDate;
    final chosenTime = timeSlot ?? _selectedTimeSlot;
    if (chosenService == null || chosenTime.isEmpty) {
      throw Exception('Select a service and available time.');
    }
    if (chosenLoc == 'home' && chosenAddress.trim().isEmpty) {
      throw Exception('Add your home address in Profile first.');
    }
    final chosenBarber = barber ?? _selectedBarber;
    final total = chosenService.price;

    // Synchronize to PostgreSQL database via API
    final result = await api.createBooking(
      customerName: userName,
      customerEmail: userEmail,
      customerPhone: userPhone.isEmpty ? deliveryPhone : userPhone,
      serviceId: chosenService.id,
      serviceName: chosenService.name,
      date: chosenDate,
      timeSlot: chosenTime,
      totalPrice: total > 0 ? total : 0,
      notes: chosenService.name,
      visitType: chosenLoc == 'home' ? 'home' : 'salon',
      serviceAddress: chosenLoc == 'home' ? chosenAddress : null,
    );
    _ensureCurrentAccount(revision, owner);

    if (result == null || result['id'] == null) {
      throw Exception(
        'Booking could not be confirmed. Refresh availability and try again.',
      );
    }
    final booking = BookingModel(
      id: result['id'].toString(),
      service: chosenService,
      barber: chosenBarber,
      locationType: chosenLoc,
      studioOrHomeAddress: chosenAddress,
      date: result['booking_date']?.toString() ?? chosenDate,
      timeSlot: result['time_slot']?.toString() ?? chosenTime,
      promoCode: null,
      discount: 0,
      homeVisitFee: 0,
      totalAmount: num.tryParse('${result['total_price']}')?.round() ?? total,
      status: BookingStatus.values.firstWhere(
        (status) =>
            status.name.toLowerCase() ==
            result['status'].toString().replaceAll('_', '').toLowerCase(),
        orElse: () => BookingStatus.confirmed,
      ),
      createdAt: DateTime.tryParse('${result['created_at']}') ?? DateTime.now(),
    );

    _bookings.insert(0, booking);
    notifyListeners();
    return booking;
  }

  // Shopping Cart
  final List<CartItem> _cart = [];
  List<CartItem> get cart => _cart;

  int get cartCount => _cart.fold(0, (sum, i) => sum + i.quantity);
  int get cartSubtotal => _cart.fold(0, (sum, i) => sum + i.subtotal);
  int get cartDeliveryFee => cartSubtotal >= 999 ? 0 : 99;
  int get cartTotal {
    final sub = cartSubtotal;
    if (sub == 0) return 0;
    final fee = sub >= 999 ? 0 : 99;
    final total = sub + fee - promoDiscount;
    return total > 0 ? total : 0;
  }

  void addToCart(ProductModel product, {int qty = 1}) {
    if (!product.inStock || qty < 1 || pendingPayment != null) return;
    final index = _cart.indexWhere((item) => item.product.id == product.id);
    if (index >= 0) {
      _cart[index].quantity = (_cart[index].quantity + qty).clamp(1, 100);
    } else {
      _cart.add(CartItem(product: product, quantity: qty.clamp(1, 100)));
    }
    _cartChanged();
  }

  void updateCartQty(String productId, int newQty) {
    if (pendingPayment != null) return;
    if (newQty <= 0) {
      _cart.removeWhere((item) => item.product.id == productId);
    } else {
      final index = _cart.indexWhere((item) => item.product.id == productId);
      if (index >= 0) {
        _cart[index].quantity = newQty.clamp(1, 100);
      }
    }
    _cartChanged();
  }

  void clearCart() {
    _cart.clear();
    _cartChanged();
  }

  // Wishlist
  final Set<String> _wishlist = {};
  Set<String> get wishlist => _wishlist;

  void toggleWishlist(String productId) {
    if (_wishlist.contains(productId)) {
      _wishlist.remove(productId);
    } else {
      _wishlist.add(productId);
    }
    unawaited(persistDraft());
    notifyListeners();
  }

  // Orders
  final List<OrderModel> _orders = [];
  List<OrderModel> get orders => _orders;

  List<Map<String, dynamic>> _buildCartApiItems() {
    return _cart
        .map((i) => {'productId': i.product.id, 'quantity': i.quantity})
        .toList();
  }

  /// Authoritative quote from the backend commerce engine
  Future<Map<String, dynamic>?> getAuthoritativeQuote() async {
    final revision = _accountRevision;
    final owner = _draftOwner;
    final quote = await api.quoteOrder(
      items: _buildCartApiItems(),
      couponCode: _appliedPromo,
    );
    if (_disposed || revision != _accountRevision || owner != _draftOwner) {
      throw const ApiException(
        'Your account changed. Please review checkout again.',
      );
    }
    checkoutQuote = quote;
    return checkoutQuote;
  }

  void _ensureCurrentAccount(int revision, String owner) {
    if (_disposed ||
        !isLoggedIn ||
        revision != _accountRevision ||
        owner != _draftOwner) {
      throw const ApiException(
        'Your account changed. Sign in to check the result.',
      );
    }
  }

  Future<void> _preservePaymentDraft(
    String owner,
    Map<String, dynamic> payment,
  ) {
    if (owner == 'guest') return Future.value();
    final next = _persistQueue.catchError((Object _) {}).then((_) async {
      final prefs = await SharedPreferences.getInstance();
      final saved = jsonDecode(prefs.getString('urban_draft_$owner') ?? '{}');
      if (saved is! Map || saved['payment'] != null) return;
      final draft = Map<String, dynamic>.from(saved)..['payment'] = payment;
      await prefs.setString('urban_draft_$owner', jsonEncode(draft));
    });
    _persistQueue = next;
    return next;
  }

  num? reviewedTotal;

  /// Places a confirmed Cash on Delivery order against Neon PostgreSQL
  Future<OrderModel> placeCodOrder() async {
    final revision = _accountRevision;
    final owner = _draftOwner;
    final quote = await getAuthoritativeQuote();
    _ensureCurrentAccount(revision, owner);
    if (quote == null) {
      throw Exception('Unable to confirm current prices. Please retry.');
    }
    final expectedTotal = quote['totalAmount'] as num;
    if (reviewedTotal != null && expectedTotal != reviewedTotal) {
      throw Exception('Prices changed. Please review the updated total.');
    }
    final idempotencyKey = _checkoutKey('cod');
    await persistDraft();
    _ensureCurrentAccount(revision, owner);

    final res = await api.placeCodOrder(
      items: _buildCartApiItems(),
      fullName: deliveryName.isEmpty ? userName : deliveryName,
      phone: deliveryPhone.isEmpty ? userPhone : deliveryPhone,
      street: _homeAddress,
      city: city,
      region: region,
      postalCode: postalCode,
      email: userEmail,
      couponCode: _appliedPromo,
      expectedTotal: expectedTotal,
      idempotencyKey: idempotencyKey,
    );
    _ensureCurrentAccount(revision, owner);

    if (res == null || res['success'] != true || res['orderId'] == null) {
      throw Exception(
        'Order was not confirmed. Please check your connection and retry.',
      );
    }
    final serverOrderId = res['orderId'].toString();

    final newOrder = OrderModel(
      id: serverOrderId,
      items: List.from(_cart),
      subtotal: (quote['subtotal'] as num?)?.toInt() ?? cartSubtotal,
      deliveryFee: (quote['shippingFee'] as num?)?.toInt() ?? cartDeliveryFee,
      discount: (quote['discountAmount'] as num?)?.toInt() ?? promoDiscount,
      grandTotal: expectedTotal.round(),
      shippingAddress: [
        _homeAddress,
        city,
        region,
        postalCode,
      ].where((v) => v.isNotEmpty).join(', '),
      paymentMethod: 'Cash on Delivery',
      status: OrderStatus.confirmed,
      orderDate: DateTime.now(),
      estimatedDelivery: 'See order status for updates',
    );

    _orders.insert(0, newOrder);
    _checkoutKeys.clear();
    clearCart();
    removePromo();
    await persistDraft();
    _ensureCurrentAccount(revision, owner);
    notifyListeners();
    return newOrder;
  }

  /// Initializes Razorpay checkout order with atomic stock lock in Neon DB
  Future<Map<String, dynamic>?> createRazorpayOrder() async {
    final revision = _accountRevision;
    final owner = _draftOwner;
    final quote = await getAuthoritativeQuote();
    _ensureCurrentAccount(revision, owner);
    if (quote == null) {
      throw Exception('Unable to confirm current prices. Please retry.');
    }
    final expectedTotal = quote['totalAmount'] as num;
    if (reviewedTotal != null && expectedTotal != reviewedTotal) {
      throw Exception('Prices changed. Please review the updated total.');
    }
    final idempotencyKey = _checkoutKey('rzp');
    await persistDraft();
    _ensureCurrentAccount(revision, owner);

    final result = await api.createRazorpayOrder(
      items: _buildCartApiItems(),
      fullName: deliveryName.isEmpty ? userName : deliveryName,
      phone: deliveryPhone.isEmpty ? userPhone : deliveryPhone,
      street: _homeAddress,
      city: city,
      region: region,
      postalCode: postalCode,
      email: userEmail,
      couponCode: _appliedPromo,
      expectedTotal: expectedTotal,
      idempotencyKey: idempotencyKey,
    );
    if (result == null ||
        result['orderId'] == null ||
        result['razorpayOrderId'] == null ||
        result['keyId'] == null ||
        result['amount'] is! num) {
      throw const ApiException(
        'The payment order is incomplete. Please retry.',
      );
    }
    if (_disposed ||
        !isLoggedIn ||
        revision != _accountRevision ||
        owner != _draftOwner) {
      await _preservePaymentDraft(owner, Map<String, dynamic>.from(result));
      _ensureCurrentAccount(revision, owner);
    }
    pendingPayment = Map<String, dynamic>.from(result);
    await persistDraft();
    _ensureCurrentAccount(revision, owner);
    notifyListeners();
    return result;
  }

  Future<OrderModel> finalizeRazorpayOrder({
    required String orderId,
    required String razorpayOrderId,
    required String razorpayPaymentId,
    required String razorpaySignature,
    required int amountInPaise,
  }) async {
    final revision = _accountRevision;
    final owner = _draftOwner;
    if (pendingPayment != null) {
      pendingPayment!['verification'] = {
        'orderId': orderId,
        'razorpayOrderId': razorpayOrderId,
        'razorpayPaymentId': razorpayPaymentId,
        'razorpaySignature': razorpaySignature,
      };
      await persistDraft();
      _ensureCurrentAccount(revision, owner);
    }
    final receipt = await api.verifyRazorpayPayment(
      orderId: orderId,
      razorpayOrderId: razorpayOrderId,
      razorpayPaymentId: razorpayPaymentId,
      razorpaySignature: razorpaySignature,
    );
    _ensureCurrentAccount(revision, owner);
    if (receipt == null ||
        receipt['success'] != true ||
        receipt['paymentStatus'] != 'captured') {
      throw const ApiException(
        'Payment confirmation is pending. Check status before trying again.',
      );
    }
    return _acceptReceipt(receipt);
  }

  Future<OrderModel?> checkPendingPayment() async {
    final revision = _accountRevision;
    final owner = _draftOwner;
    final payment = pendingPayment;
    if (payment == null) return null;
    final status = await api.reconcilePayment(payment['orderId'].toString());
    _ensureCurrentAccount(revision, owner);
    if (status['receipt'] is Map) {
      final receipt = Map<String, dynamic>.from(status['receipt']);
      if (receipt['success'] == true &&
          receipt['paymentStatus'] == 'captured') {
        return _acceptReceipt(receipt);
      }
    }
    if (status['cancelled'] == true) {
      pendingPayment = null;
      _checkoutKeys.clear();
      await persistDraft();
      notifyListeners();
    }
    return null;
  }

  Future<OrderModel> _acceptReceipt(Map<String, dynamic> receipt) async {
    final revision = _accountRevision;
    final owner = _draftOwner;
    final address = receipt['shippingAddress'] as Map? ?? {};
    int amount(dynamic v) => num.tryParse('$v')?.round() ?? 0;
    final order = OrderModel(
      id: receipt['orderId'].toString(),
      items: (receipt['items'] as List? ?? [])
          .map(
            (row) => CartItem(
              product: ProductModel.fromJson({
                'id': row['product_id'] ?? row['id'],
                'name': row['product_name'],
                'price': amount(row['unit_price']),
                'imageUrl': row['image_url'],
              }),
              quantity: amount(row['quantity']),
            ),
          )
          .toList(),
      subtotal: amount(receipt['subtotal']),
      deliveryFee: amount(receipt['shippingFee']),
      discount: amount(receipt['discountAmount']),
      grandTotal: amount(receipt['totalAmount']),
      shippingAddress: [
        'street',
        'city',
        'state',
        'postalCode',
      ].map((k) => address[k] ?? '').join(', '),
      paymentMethod: 'Razorpay',
      paymentStatus: receipt['paymentStatus'] ?? 'pending',
      transactionId: receipt['paymentId'] ?? '',
      status: OrderStatus.confirmed,
      orderDate:
          DateTime.tryParse('${receipt['confirmedAt']}') ?? DateTime.now(),
      estimatedDelivery: 'Updates will appear in your orders',
    );
    _orders.removeWhere((o) => o.id == order.id);
    _orders.insert(0, order);
    pendingPayment = null;
    _checkoutKeys.clear();
    clearCart();
    removePromo();
    await persistDraft();
    _ensureCurrentAccount(revision, owner);
    unawaited(syncCart());
    return order;
  }

  List<SavedAddress> _addresses = const [];
  List<SavedAddress> get addresses => _addresses;
  String? selectedDeliveryAddressId, addressesError, requestingReturnId;
  bool isLoadingAddresses = false, isSavingAddress = false;
  int? _addressesLoadingRevision, _addressMutationRevision;
  int _addressDataRevision = 0;

  Future<void> loadAddresses() async {
    final revision = _accountRevision;
    final addressRevision = _addressDataRevision;
    if (!isLoggedIn ||
        (isLoadingAddresses && _addressesLoadingRevision == revision)) {
      return;
    }
    _addressesLoadingRevision = revision;
    isLoadingAddresses = true;
    addressesError = null;
    notifyListeners();
    try {
      final rows = await api.fetchAddresses();
      if (_disposed ||
          !isLoggedIn ||
          revision != _accountRevision ||
          addressRevision != _addressDataRevision) {
        return;
      }
      await _applyAddressBook(rows);
    } catch (error) {
      if (revision == _accountRevision) addressesError = error.toString();
    } finally {
      if (_addressesLoadingRevision == revision) {
        isLoadingAddresses = false;
        notifyListeners();
      }
    }
  }

  Future<void> _changeAddresses(
    Future<List<SavedAddress>> Function() change,
  ) async {
    final revision = _accountRevision;
    final owner = _draftOwner;
    _ensureCurrentAccount(revision, owner);
    if (isSavingAddress && _addressMutationRevision == revision) {
      throw const ApiException('An address change is already in progress.');
    }
    _addressMutationRevision = revision;
    _addressDataRevision++;
    isSavingAddress = true;
    addressesError = null;
    notifyListeners();
    try {
      final rows = await change();
      _ensureCurrentAccount(revision, owner);
      await _applyAddressBook(rows);
    } catch (error) {
      if (revision == _accountRevision) addressesError = error.toString();
      rethrow;
    } finally {
      if (_addressMutationRevision == revision) {
        isSavingAddress = false;
        notifyListeners();
      }
    }
  }

  Future<void> _applyAddressBook(List<SavedAddress> rows) async {
    _addresses = rows;
    if (selectedDeliveryAddressId != null) {
      final selected = rows.where((row) => row.id == selectedDeliveryAddressId);
      if (selected.isNotEmpty) {
        await useSavedAddress(selected.first);
      } else if (rows.isNotEmpty) {
        await useSavedAddress(
          rows.firstWhere((row) => row.isDefault, orElse: () => rows.first),
        );
      } else {
        selectedDeliveryAddressId = null;
        deliveryName = '';
        deliveryPhone = '';
        _homeAddress = '';
        city = '';
        region = '';
        postalCode = '';
        await persistDraft();
      }
    } else if (_homeAddress.isEmpty && rows.isNotEmpty) {
      await useSavedAddress(
        rows.firstWhere((row) => row.isDefault, orElse: () => rows.first),
      );
    }
  }

  Future<void> saveAddress(SavedAddress address) =>
      _changeAddresses(() => api.saveAddress(address));
  Future<void> removeAddress(String id) =>
      _changeAddresses(() => api.removeAddress(id));
  Future<void> setDefaultAddress(String id) =>
      _changeAddresses(() => api.setDefaultAddress(id));

  Future<void> useSavedAddress(SavedAddress address) async {
    final revision = _accountRevision;
    final owner = _draftOwner;
    _ensureCurrentAccount(revision, owner);
    final matches = _addresses.where((row) => row.id == address.id);
    if (matches.isEmpty) {
      throw const ApiException(
        'This saved address is no longer available. Refresh the address book.',
      );
    }
    final selected = matches.first;
    selectedDeliveryAddressId = selected.id;
    deliveryName = selected.fullName;
    deliveryPhone = selected.mobile;
    _homeAddress = selected.streetLine;
    city = selected.city;
    region = selected.region;
    postalCode = selected.pinCode;
    await persistDraft();
    _ensureCurrentAccount(revision, owner);
    notifyListeners();
  }

  Future<OrderModel> requestOrderReturn(
    OrderModel order,
    String category,
    String details,
    bool acknowledged,
  ) async {
    final revision = _accountRevision;
    final owner = _draftOwner;
    _ensureCurrentAccount(revision, owner);
    if (requestingReturnId != null) {
      throw const ApiException('A return request is already being submitted.');
    }
    if (!order.canRequestReturn ||
        !returnReasons.contains(category) ||
        details.trim().length < 3 ||
        details.trim().length > 400 ||
        !acknowledged) {
      throw const ApiException(
        'Choose a reason, describe the issue, and confirm the full-order return.',
      );
    }
    requestingReturnId = order.id;
    notifyListeners();
    try {
      final data = await api.request(
        'POST',
        'orders/${Uri.encodeComponent(order.id)}/return',
        body: {'reason': '$category: ${details.trim()}'},
      );
      _ensureCurrentAccount(revision, owner);
      if (data is! Map || data['ok'] != true || data['order'] is! Map) {
        throw const ApiException(
          'The return was not confirmed. Refresh your orders before retrying.',
        );
      }
      final saved = OrderModel.fromJson(
        Map<String, dynamic>.from(data['order']),
      );
      if (saved.id != order.id || saved.aftercare.returnStatus == null) {
        throw const ApiException(
          'The return was not confirmed. Refresh your orders before retrying.',
        );
      }
      final index = _orders.indexWhere((row) => row.id == saved.id);
      if (index >= 0) _orders[index] = saved;
      return saved;
    } finally {
      if (revision == _accountRevision) {
        requestingReturnId = null;
        notifyListeners();
      }
    }
  }

  Future<ReturnAudit> loadReturnAudit(String id) async {
    final revision = _accountRevision;
    final owner = _draftOwner;
    _ensureCurrentAccount(revision, owner);
    await api.ensureAuthSession();
    final data = await api.request(
      'GET',
      'orders/${Uri.encodeComponent(id)}/return',
    );
    _ensureCurrentAccount(revision, owner);
    if (data is! Map || data['order'] is! Map || data['events'] is! List) {
      throw const ApiException(
        'The return history could not be read. Please retry.',
      );
    }
    final order = OrderModel.fromJson(Map<String, dynamic>.from(data['order']));
    if (order.id != id) {
      throw const ApiException('The return record does not match this order.');
    }
    return ReturnAudit(
      order,
      List.unmodifiable(
        (data['events'] as List).map((event) {
          if (event is! Map) {
            throw const ApiException('The return timeline could not be read.');
          }
          return ReturnEvent.fromJson(Map<String, dynamic>.from(event));
        }),
      ),
    );
  }

  Object get accountSessionKey =>
      (_accountRevision, isLoggedIn, api.currentUserId);

  Future<List<String>> fetchRescheduleSlots(
    BookingModel booking,
    String date,
  ) async {
    final revision = _accountRevision;
    final owner = _draftOwner;
    _ensureCurrentAccount(revision, owner);
    final data = await api.request(
      'GET',
      'bookings/${Uri.encodeComponent(booking.id)}/available-slots?date=${Uri.encodeQueryComponent(date)}',
    );
    _ensureCurrentAccount(revision, owner);
    if (data is! Map ||
        data['availableSlots'] is! List ||
        (data['availableSlots'] as List).any(
          (slot) => slot is! String || slot.trim().isEmpty,
        )) {
      throw const ApiException('Availability could not be read. Please retry.');
    }
    return List<String>.from(data['availableSlots']);
  }

  Future<void> rescheduleBooking(
    BookingModel booking,
    String date,
    String slot,
  ) async {
    final revision = _accountRevision;
    final owner = _draftOwner;
    _ensureCurrentAccount(revision, owner);
    final data = await api.request(
      'PUT',
      'bookings/${Uri.encodeComponent(booking.id)}/schedule',
      body: {
        'bookingDate': date,
        'timeSlot': slot,
        'expectedDate': booking.date,
        'expectedTimeSlot': booking.timeSlot,
      },
    );
    _ensureCurrentAccount(revision, owner);
    if (data is! Map ||
        data['id'] != booking.id ||
        data['booking_date'] != date ||
        data['time_slot'] != slot ||
        data['status'] != 'confirmed') {
      throw const ApiException(
        'The new appointment was not confirmed. Refresh before retrying.',
      );
    }
    final index = _bookings.indexWhere((row) => row.id == booking.id);
    if (index >= 0) _bookings[index] = booking.withSchedule(date, slot);
    notifyListeners();
  }

  String? historyError;
  bool isLoadingHistory = false;
  int? _historyLoadingRevision;
  Future<void> loadHistory() async {
    final revision = _accountRevision;
    if (!isLoggedIn ||
        (isLoadingHistory && _historyLoadingRevision == revision)) {
      return;
    }
    _historyLoadingRevision = revision;
    isLoadingHistory = true;
    historyError = null;
    notifyListeners();
    final userId = api.currentUserId;
    try {
      final results = await Future.wait([
        api.fetchHistory('orders'),
        api.fetchHistory('bookings'),
      ]);
      if (_disposed ||
          !isLoggedIn ||
          revision != _accountRevision ||
          api.currentUserId != userId) {
        return;
      }
      int amount(dynamic value) => num.tryParse('$value')?.round() ?? 0;
      final orders = results[0].map((row) {
        if (row is! Map) {
          throw const ApiException(
            'The order history could not be read. Please retry.',
          );
        }
        return OrderModel.fromJson(Map<String, dynamic>.from(row));
      }).toList();
      final bookings = <BookingModel>[];
      for (final row in results[1]) {
        final notes = row['notes']?.toString() ?? '';
        final home =
            row['visit_type'] == 'home' ||
            notes.contains('Location: home. Address: ');
        final savedAddress = home
            ? row['service_address']?.toString() ??
                  notes.split('Location: home. Address: ').last.trim()
            : SalonConstants.studioAddress;
        bookings.add(
          BookingModel(
            id: row['id'].toString(),
            service: ServiceModel(
              id: '',
              name: notes.split('. Location: ').first.isEmpty
                  ? 'Salon appointment'
                  : notes.split('. Location: ').first,
              duration: '',
              price: amount(row['total_price']),
              description: '',
              category: '',
            ),
            barber: BarberModel(
              id: '',
              name: row['stylist_name'] ?? 'Assigned by salon',
              title: row['stylist_role'] ?? '',
              rating: 0,
              reviewsCount: 0,
              avatarUrl: '',
              experience: '',
              bio: '',
            ),
            locationType: home ? 'home' : 'studio',
            studioOrHomeAddress: savedAddress,
            date: row['booking_date'].toString().split('T').first,
            timeSlot: row['time_slot'] ?? '',
            totalAmount: amount(row['total_price']),
            status: BookingStatus.values.firstWhere(
              (v) =>
                  v.name.toLowerCase() ==
                  row['status'].toString().replaceAll('_', '').toLowerCase(),
              orElse: () => BookingStatus.confirmed,
            ),
            createdAt: DateTime.parse(row['created_at']),
          ),
        );
      }
      _orders
        ..clear()
        ..addAll(orders);
      _bookings
        ..clear()
        ..addAll(bookings);
    } catch (e) {
      if (revision == _accountRevision) historyError = e.toString();
    } finally {
      if (_historyLoadingRevision == revision) {
        isLoadingHistory = false;
        notifyListeners();
      }
    }
  }

  final Map<String, String> _checkoutKeys = {};
  String _checkoutKey(String method) {
    final fingerprint = jsonEncode([
      method,
      api.currentUserId,
      _buildCartApiItems(),
      _homeAddress,
      city,
      region,
      postalCode,
      _appliedPromo,
      deliveryName,
      deliveryPhone,
      reviewedTotal,
    ]);
    return _checkoutKeys.putIfAbsent(
      fingerprint,
      () => '$method-${DateTime.now().microsecondsSinceEpoch}',
    );
  }

  // User Profile
  String userName = 'Guest';
  String userPhone = '';
  String userEmail = '';
  String memberTier = 'Urban Blade';
  int rewardsPoints = 0;
  bool isLoggedIn = false;

  void _setUser(Map<String, dynamic> user) {
    userName = user['name'] ?? '';
    userPhone = user['phone'] ?? '';
    userEmail = user['email'] ?? '';
    isLoggedIn = true;
  }

  Future<void> signIn({
    required String email,
    required String password,
    String? name,
    String? phone,
  }) async {
    final revision = ++_accountRevision;
    final guestItems = _draftOwner == 'guest'
        ? _cart
              .map((i) => CartItem(product: i.product, quantity: i.quantity))
              .toList()
        : <CartItem>[];
    final user = await api.authenticate(
      email: email,
      password: password,
      name: name,
      phone: phone,
    );
    if (_disposed || revision != _accountRevision) return;
    _setUser(user);
    _draftOwner = api.currentUserId!;
    await _restoreDraft();
    if (_disposed || revision != _accountRevision) return;
    if (guestItems.isNotEmpty && pendingPayment == null) {
      for (final item in guestItems) {
        final index = _cart.indexWhere(
          (row) => row.product.id == item.product.id,
        );
        if (index < 0) {
          _cart.add(item);
        } else if (_cart[index].quantity < item.quantity) {
          _cart[index] = item;
        }
      }
      _cartDirty = true;
      await persistDraft();
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove('urban_draft_guest');
    }
    notifyListeners();
    // Sign-in returns immediately; history and cart display their own sync state.
    unawaited(loadHistory());
    unawaited(loadAddresses());
    unawaited(refreshCart(guestItems: guestItems));
  }

  Future<void> logout() async {
    _accountRevision++;
    _cartTimer?.cancel();
    await persistDraft();
    _loggingOut = true;
    final logoutRequest = api.logout();
    isLoggedIn = false;
    userName = 'Guest';
    userEmail = '';
    userPhone = '';
    _bookings.clear();
    _orders.clear();
    _addresses = const [];
    _addressDataRevision++;
    isLoadingAddresses = false;
    isSavingAddress = false;
    isLoadingHistory = false;
    addressesError = null;
    requestingReturnId = null;
    selectedDeliveryAddressId = null;
    _cart.clear();
    _wishlist.clear();
    _homeAddress = '';
    city = '';
    region = '';
    postalCode = '';
    deliveryName = '';
    deliveryPhone = '';
    pendingPayment = null;
    _checkoutKeys.clear();
    checkoutQuote = null;
    reviewedTotal = null;
    _cartDirty = false;
    _cartRevision++;
    _draftOwner = 'guest';
    removePromo();
    historyError = null;
    syncError = null;
    await _restoreDraft();
    notifyListeners();
    try {
      await logoutRequest;
    } finally {
      _loggingOut = false;
    }
    syncError = null;
    notifyListeners();
  }
}
