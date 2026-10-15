import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../constants/salon_constants.dart';
import '../models/product_model.dart';
import '../models/service_model.dart';
import '../models/barber_model.dart';
import '../models/address_model.dart';

class ApiException implements Exception {
  final String message;
  final int? status;
  final String? code;
  const ApiException(this.message, {this.status, this.code});
  @override
  String toString() => message;
}

class ApiService {
  final String baseUrl;
  final http.Client client;
  final Duration timeout;
  String? authToken, currentUserId, _refreshToken;
  Map<String, dynamic>? cachedUser;
  void Function()? onSessionExpired;
  Future<void>? _refreshing;
  int _sessionGeneration = 0;
  Future<void> _sessionWrites = Future.value();
  int _catalogGeneration = 0;
  final Map<String, Future<List<ProductModel>>> _productRequests = {};
  final Map<int, Future<List<ServiceModel>>> _serviceRequests = {};
  final Map<int, Future<List<BarberModel>>> _stylistRequests = {};

  List<ProductModel>? _cachedProducts;
  DateTime? _productsCacheTime;
  int? _productsCacheLimit;
  List<ServiceModel>? _cachedServices;
  DateTime? _servicesCacheTime;
  List<BarberModel>? _cachedStylists;
  DateTime? _stylistsCacheTime;
  static const Duration _catalogCacheTtl = Duration(minutes: 5);

  void clearCatalogCache() {
    _catalogGeneration++;
    _cachedProducts = null;
    _productsCacheTime = null;
    _productsCacheLimit = null;
    _cachedServices = null;
    _servicesCacheTime = null;
    _cachedStylists = null;
    _stylistsCacheTime = null;
  }

  ApiService({
    this.baseUrl = SalonConstants.apiBaseUrl,
    http.Client? client,
    this.timeout = const Duration(seconds: 45),
  }) : client = client ?? http.Client();

  Future<void> ensureAuthSession() async {
    if (authToken == null) {
      throw const ApiException('Please sign in to continue.', status: 401);
    }
  }

  Future<http.Response> _send(
    String method,
    Uri url, {
    Map<String, dynamic>? body,
    String? key,
    bool retryAuth = true,
  }) async {
    final generation = _sessionGeneration;
    final sentToken = authToken;
    final headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      if (sentToken != null) 'Authorization': 'Bearer $sentToken',
      if (key != null) 'x-idempotency-key': key,
    };
    http.Response response;
    try {
      switch (method) {
        case 'POST':
          response = await client
              .post(url, headers: headers, body: jsonEncode(body ?? {}))
              .timeout(timeout);
        case 'PUT':
          response = await client
              .put(url, headers: headers, body: jsonEncode(body ?? {}))
              .timeout(timeout);
        case 'DELETE':
          response = await client
              .delete(url, headers: headers, body: jsonEncode(body ?? {}))
              .timeout(timeout);
        case 'PATCH':
          response = await client
              .patch(url, headers: headers, body: jsonEncode(body ?? {}))
              .timeout(timeout);
        default:
          response = await client.get(url, headers: headers).timeout(timeout);
      }
    } on TimeoutException {
      throw const ApiException(
        'The server is taking longer than expected. Check your connection and retry.',
      );
    } on http.ClientException {
      throw const ApiException(
        'Could not connect. Check your connection and retry. If you submitted an order or payment, check its status before trying again.',
      );
    }
    if (sentToken != null && generation != _sessionGeneration) {
      throw const ApiException('Session changed. Please sign in again.');
    }
    if (response.statusCode == 401 &&
        retryAuth &&
        authToken != null &&
        !url.path.contains('/auth/login') &&
        !url.path.contains('/auth/register')) {
      if (sentToken != authToken) {
        return _send(method, url, body: body, key: key, retryAuth: false);
      }
      if (_refreshToken != null) {
        await (_refreshing ??= _refreshSession().whenComplete(
          () => _refreshing = null,
        ));
        if (generation != _sessionGeneration) {
          throw const ApiException('Session changed. Please sign in again.');
        }
        return _send(method, url, body: body, key: key, retryAuth: false);
      }
      await _expireSession();
    }
    if (response.statusCode >= 400) {
      if (response.statusCode == 401 && !retryAuth) await _expireSession();
      Map<String, dynamic> error = {};
      try {
        error = Map<String, dynamic>.from(jsonDecode(response.body));
      } catch (_) {}
      final message = error['message']?.toString();
      final missingRescheduleRoute =
          response.statusCode == 404 &&
          RegExp(
            r'/api/bookings/[^/]+/(available-slots|schedule)$',
          ).hasMatch(url.path) &&
          message != null &&
          message.startsWith('Route ') &&
          message.endsWith(' not found');
      if (missingRescheduleRoute) {
        throw const ApiException(
          'Appointment rescheduling is temporarily unavailable. Your appointment has not changed. Contact the studio to change the time.',
          status: 404,
          code: 'RESCHEDULING_UNAVAILABLE',
        );
      }
      throw ApiException(
        message ??
            (response.statusCode == 401
                ? 'Your session expired. Please sign in again.'
                : 'Request failed (${response.statusCode}). Please retry.'),
        status: response.statusCode,
        code: error['error']?.toString(),
      );
    }
    return response;
  }

  Future<dynamic> request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    String? key,
  }) async {
    final response = await _send(
      method,
      Uri.parse('$baseUrl/api/$path'),
      body: body,
      key: key,
    );
    try {
      return jsonDecode(response.body);
    } catch (_) {
      throw const ApiException(
        'The server returned an unexpected response. Please retry.',
      );
    }
  }

  Future<void> _saveSession(Map<String, dynamic> data) async {
    final token = data['token'];
    final user = data['user'];
    if (token is! String ||
        token.isEmpty ||
        user is! Map ||
        user['id'] == null) {
      throw const ApiException('Sign-in could not be completed. Please retry.');
    }
    authToken = token;
    _refreshToken = data['refreshToken'] as String? ?? _refreshToken;
    cachedUser = Map<String, dynamic>.from(user);
    currentUserId = cachedUser!['id'].toString();
    final refreshToken = _refreshToken;
    final savedUser = jsonEncode(cachedUser);
    await _queueSessionWrite((prefs) async {
      await prefs.setString('urban_verified_token', token);
      if (refreshToken != null) {
        await prefs.setString('urban_refresh_token', refreshToken);
      } else {
        await prefs.remove('urban_refresh_token');
      }
      await prefs.setString('urban_session_user', savedUser);
    });
  }

  Future<void> _queueSessionWrite(
    Future<void> Function(SharedPreferences prefs) write,
  ) {
    final next = _sessionWrites.catchError((Object _) {}).then((_) async {
      await write(await SharedPreferences.getInstance());
    });
    _sessionWrites = next;
    return next;
  }

  Future<void> _refreshSession() async {
    final generation = _sessionGeneration;
    try {
      final response = await _send(
        'POST',
        Uri.parse('$baseUrl/api/auth/refresh'),
        body: {'refreshToken': _refreshToken},
        retryAuth: false,
      );
      if (generation != _sessionGeneration) {
        throw const ApiException('Session changed. Please sign in again.');
      }
      await _saveSession(Map<String, dynamic>.from(jsonDecode(response.body)));
      if (generation != _sessionGeneration) {
        throw const ApiException('Session changed. Please sign in again.');
      }
    } on ApiException catch (error) {
      if (generation == _sessionGeneration &&
          (error.status == 401 || error.status == 403)) {
        await _expireSession();
      }
      rethrow;
    }
  }

  Future<Map<String, dynamic>?> restoreSession() async {
    final generation = _sessionGeneration;
    final prefs = await SharedPreferences.getInstance();
    if (generation != _sessionGeneration) return null;
    authToken = prefs.getString('urban_verified_token');
    _refreshToken = prefs.getString('urban_refresh_token');
    if (authToken == null) return null;
    try {
      cachedUser = Map<String, dynamic>.from(
        jsonDecode(prefs.getString('urban_session_user') ?? '{}'),
      );
    } catch (_) {}
    currentUserId = cachedUser?['id']?.toString();
    try {
      final data = await request('GET', 'auth/me');
      if (generation != _sessionGeneration) return null;
      cachedUser = Map<String, dynamic>.from(data['user']);
      currentUserId = cachedUser!['id'].toString();
      final savedUser = jsonEncode(cachedUser);
      await _queueSessionWrite((prefs) async {
        await prefs.setString('urban_session_user', savedUser);
      });
      if (generation != _sessionGeneration) return null;
      return cachedUser;
    } on ApiException catch (error) {
      if (error.status == 401 || error.status == 403) return null;
      // A temporary connection failure must not revoke a valid stored session.
      if (cachedUser?['id'] != null) return cachedUser;
      rethrow;
    }
  }

  Future<void> _expireSession() async {
    final hadSession = authToken != null || cachedUser != null;
    _sessionGeneration++;
    authToken = null;
    currentUserId = null;
    _refreshToken = null;
    cachedUser = null;
    if (hadSession) onSessionExpired?.call();
    await _queueSessionWrite((prefs) async {
      for (final key in [
        'urban_verified_token',
        'urban_refresh_token',
        'urban_session_user',
        'urban_auth_token',
        'urban_user_id',
      ]) {
        await prefs.remove(key);
      }
    });
  }

  Future<void> logout() async {
    final token = authToken;
    await _expireSession();
    if (token != null) {
      try {
        await client
            .post(
              Uri.parse('$baseUrl/api/auth/logout'),
              headers: {'Authorization': 'Bearer $token'},
            )
            .timeout(const Duration(seconds: 8));
      } catch (_) {}
    }
  }

  Future<Map<String, dynamic>> authenticate({
    required String email,
    required String password,
    String? name,
    String? phone,
  }) async {
    final generation = ++_sessionGeneration;
    final data = await request(
      'POST',
      name == null ? 'auth/login' : 'auth/register',
      body: {
        'email': email.trim().toLowerCase(),
        'password': password,
        if (name != null) 'name': name.trim(),
        if (phone != null) 'phone': phone,
      },
    );
    if (generation != _sessionGeneration) {
      throw const ApiException('Session changed. Please sign in again.');
    }
    // A fresh login must never inherit another account's refresh credential.
    _refreshToken = null;
    await _saveSession(Map<String, dynamic>.from(data));
    if (generation != _sessionGeneration) {
      throw const ApiException('Session changed. Please sign in again.');
    }
    return cachedUser!;
  }

  Future<List<SavedAddress>> fetchAddresses() async {
    await ensureAuthSession();
    return _addressRows(await request('GET', 'account/addresses'));
  }

  List<SavedAddress> _addressRows(Object? value) {
    try {
      if (value is! List || value.any((row) => row is! Map)) {
        throw const FormatException();
      }
      return List.unmodifiable(
        value.map(
          (row) => SavedAddress.fromJson(Map<String, dynamic>.from(row)),
        ),
      );
    } catch (_) {
      throw const ApiException(
        'The address book could not be read. Please retry.',
      );
    }
  }

  Future<List<SavedAddress>> saveAddress(SavedAddress address) async {
    await ensureAuthSession();
    final path =
        'account/addresses${address.id.isEmpty ? '' : '/${Uri.encodeComponent(address.id)}'}';
    return _addressRows(
      await request(
        address.id.isEmpty ? 'POST' : 'PUT',
        path,
        body: Map<String, dynamic>.from(address.toJson()),
      ),
    );
  }

  Future<List<SavedAddress>> removeAddress(String id) async {
    await ensureAuthSession();
    return _addressRows(
      await request('DELETE', 'account/addresses/${Uri.encodeComponent(id)}'),
    );
  }

  Future<List<SavedAddress>> setDefaultAddress(String id) async {
    await ensureAuthSession();
    return _addressRows(
      await request(
        'PATCH',
        'account/addresses/${Uri.encodeComponent(id)}/default',
      ),
    );
  }

  Future<List<dynamic>> fetchHistory(String resource) async {
    await ensureAuthSession();
    return List<dynamic>.from(await request('GET', resource));
  }

  Future<List<dynamic>> fetchCart() async =>
      List<dynamic>.from((await request('GET', 'auth/cart'))['items'] ?? []);
  Future<void> saveCart(List<Map<String, dynamic>> items) async {
    await request('POST', 'auth/cart', body: {'items': items});
  }

  Future<Map<String, dynamic>> updateProfile(String name, String phone) async {
    final generation = _sessionGeneration;
    final user = Map<String, dynamic>.from(
      (await request(
        'PATCH',
        'auth/profile',
        body: {'name': name, 'phone': phone},
      ))['user'],
    );
    if (generation != _sessionGeneration || authToken == null) {
      throw const ApiException('Session changed. Please sign in again.');
    }
    cachedUser = user;
    await _queueSessionWrite((prefs) async {
      await prefs.setString('urban_session_user', jsonEncode(user));
    });
    return user;
  }

  Future<Map<String, dynamic>> reconcilePayment(String orderId) async =>
      Map<String, dynamic>.from(
        await request('POST', 'orders/$orderId/reconcile', body: {}),
      );
  Future<Map<String, dynamic>> fetchSettings() async =>
      Map<String, dynamic>.from(await request('GET', 'settings'));

  List<Map<String, dynamic>> _catalogRows(String body) {
    Object? decoded;
    try {
      decoded = jsonDecode(body);
    } on FormatException {
      throw const ApiException('The catalog could not be read. Please retry.');
    }
    final rows = decoded is Map ? decoded['data'] : decoded;
    if (rows is! List) {
      throw const ApiException('The catalog could not be read. Please retry.');
    }
    return rows
        .whereType<Map>()
        .where((row) {
          final price = num.tryParse('${row['price']}');
          return (row['id'] ?? row['slug'])?.toString().isNotEmpty == true &&
              row['name']?.toString().isNotEmpty == true &&
              price != null &&
              price.isFinite &&
              price >= 0;
        })
        .map((row) => Map<String, dynamic>.from(row))
        .toList();
  }

  // ─── 1. PRODUCTS & CATALOG FROM DATABASE ──────────────────────────────────
  Future<List<ProductModel>> fetchProducts({int page = 1, int limit = 100}) {
    final key = '$_catalogGeneration:$page:$limit';
    return _productRequests.putIfAbsent(
      key,
      () => _fetchProducts(page: page, limit: limit).whenComplete(() {
        _productRequests.remove(key);
      }),
    );
  }

  Future<List<ProductModel>> _fetchProducts({
    required int page,
    required int limit,
  }) async {
    final generation = _catalogGeneration;
    if (page == 1 &&
        _cachedProducts != null &&
        _productsCacheLimit == limit &&
        _productsCacheTime != null &&
        DateTime.now().difference(_productsCacheTime!) < _catalogCacheTtl) {
      return _cachedProducts!;
    }
    try {
      final url = Uri.parse('$baseUrl/api/products?page=$page&limit=$limit');
      final res = await _send('GET', url);

      if (res.statusCode == 200) {
        final data = _catalogRows(res.body);
        final products = data
            .where(
              (row) =>
                  row['kind'] != 'service' && row['category'] != 'services',
            )
            .map((row) {
              final highlights = row['highlights'] is List
                  ? (row['highlights'] as List)
                        .map((value) => value.toString())
                        .toList()
                  : <String>[];
              final volume = highlights.where(
                (value) => RegExp(
                  r'\d+\s*(ml|g)',
                  caseSensitive: false,
                ).hasMatch(value),
              );
              return ProductModel.fromJson({
                ...row,
                'id': row['id'] ?? row['slug'],
                'imageUrl':
                    row['image_url'] ??
                    row['imageUrl'] ??
                    '/images/products/hc-shampoo.jpg',
                'volume': row['volume'] ?? (volume.isEmpty ? '' : volume.first),
              });
            })
            .toList();

        if (page == 1 && generation == _catalogGeneration) {
          _cachedProducts = products;
          _productsCacheTime = DateTime.now();
          _productsCacheLimit = limit;
        }
        return products;
      }
    } catch (_) {
      rethrow;
    }
    throw const ApiException('Unable to load the catalog. Please retry.');
  }

  // ─── 2. SERVICES FROM DATABASE ───────────────────────────────────────────
  Future<List<ServiceModel>> fetchServices() {
    final generation = _catalogGeneration;
    return _serviceRequests.putIfAbsent(
      generation,
      () => _fetchServices().whenComplete(() {
        _serviceRequests.remove(generation);
      }),
    );
  }

  Future<List<ServiceModel>> _fetchServices() async {
    final generation = _catalogGeneration;
    if (_cachedServices != null &&
        _servicesCacheTime != null &&
        DateTime.now().difference(_servicesCacheTime!) < _catalogCacheTtl) {
      return _cachedServices!;
    }
    try {
      final url = Uri.parse('$baseUrl/api/products?cat=services&limit=100');
      final res = await _send('GET', url);

      if (res.statusCode == 200) {
        final services = _catalogRows(res.body)
            .where(
              (row) =>
                  (row['kind'] == 'service' || row['category'] == 'services') &&
                  (row['in_stock'] ?? row['inStock'] ?? true) == true,
            )
            .map((row) {
              final product = ProductModel.fromJson(row);
              final durations = product.highlights.where(
                (value) => value.contains('min'),
              );
              return ServiceModel(
                id: product.id,
                name: product.name,
                duration:
                    row['duration']?.toString() ??
                    (durations.isEmpty ? '45 min' : durations.first),
                price: product.price,
                compareAtPrice: product.compareAtPrice,
                description: product.description,
                tags: product.highlights,
                isPopular:
                    product.badge == 'bestseller' || product.badge == 'deal',
                category: row['serviceCategory']?.toString() ?? 'hair',
                imageUrl: product.imageUrl.isEmpty
                    ? '/images/products/svc-mens-haircut.jpg'
                    : product.imageUrl,
              );
            })
            .toList();
        if (generation == _catalogGeneration) {
          _cachedServices = services;
          _servicesCacheTime = DateTime.now();
        }
        return services;
      }
    } catch (_) {
      rethrow;
    }
    throw const ApiException('Unable to load the catalog. Please retry.');
  }

  // ─── 3. STYLISTS & SLOTS FROM DATABASE ────────────────────────────────────
  Future<List<BarberModel>> fetchStylists() {
    final generation = _catalogGeneration;
    return _stylistRequests.putIfAbsent(
      generation,
      () => _fetchStylists().whenComplete(() {
        _stylistRequests.remove(generation);
      }),
    );
  }

  Future<List<BarberModel>> _fetchStylists() async {
    final generation = _catalogGeneration;
    if (_cachedStylists != null &&
        _stylistsCacheTime != null &&
        DateTime.now().difference(_stylistsCacheTime!) < _catalogCacheTtl) {
      return _cachedStylists!;
    }
    try {
      final url = Uri.parse('$baseUrl/api/bookings/stylists');
      final res = await _send('GET', url);

      if (res.statusCode == 200) {
        final List<dynamic> data = jsonDecode(res.body);
        final stylists = data.map((json) {
          return BarberModel(
            id: json['id']?.toString() ?? 'stylist',
            name: json['name'] as String? ?? 'Master Stylist',
            title: json['role'] ?? json['title'] ?? 'Master Barber & Stylist',
            rating: double.tryParse('${json['rating']}') ?? 0,
            reviewsCount: int.tryParse('${json['review_count'] ?? 0}') ?? 0,
            avatarUrl:
                json['avatar_url'] ??
                json['avatarUrl'] ??
                '/images/stylists/vikram.jpg',
            experience: json['experience']?.toString() ?? '',
            bio:
                json['bio'] as String? ??
                'Expert artisan stylist at Urban Blade Studio.',
            specialties: (json['specialties'] is List)
                ? List<String>.from(json['specialties'])
                : [],
          );
        }).toList();

        if (generation == _catalogGeneration) {
          _cachedStylists = stylists;
          _stylistsCacheTime = DateTime.now();
        }
        return stylists;
      }
    } catch (_) {
      rethrow;
    }
    throw const ApiException('Unable to load the catalog. Please retry.');
  }

  Future<List<String>> fetchAvailableSlots(
    String stylistId,
    String date,
  ) async {
    // Availability belongs to the date; staff assignment is private.
    final url = Uri.parse(
      '$baseUrl/api/bookings/available-slots',
    ).replace(queryParameters: {'date': date});
    final response = await _send('GET', url);
    Object? decoded;
    try {
      decoded = jsonDecode(response.body);
    } on FormatException {
      throw const ApiException(
        'Availability could not be read. Please retry or choose another date.',
      );
    }
    final slots = decoded is Map ? decoded['availableSlots'] : null;
    if (slots is! List ||
        slots.any((slot) => slot is! String || slot.trim().isEmpty)) {
      throw const ApiException(
        'Availability could not be read. Please retry or choose another date.',
      );
    }
    return slots.cast<String>().map((slot) => slot.trim()).toSet().toList();
  }

  Future<Map<String, dynamic>?> createBooking({
    required String customerName,
    required String customerEmail,
    required String customerPhone,
    String? stylistId,
    String? serviceId,
    required String serviceName,
    required String date,
    required String timeSlot,
    required int totalPrice,
    String? notes,
    String visitType = 'salon',
    String? serviceAddress,
  }) async {
    await ensureAuthSession();
    return Map<String, dynamic>.from(
      await request(
        'POST',
        'bookings',
        body: {
          'customer_name': customerName,
          'customer_email': customerEmail,
          'customer_phone': customerPhone,
          if (serviceId != null && serviceId.isNotEmpty)
            'service_id': serviceId,
          'serviceName': serviceName,
          'booking_date': date,
          'time_slot': timeSlot,
          'total_price': totalPrice,
          'notes': notes ?? serviceName,
          'visit_type': visitType,
          if (visitType == 'home') 'service_address': serviceAddress,
        },
      ),
    );
  }

  Future<Map<String, dynamic>?> quoteOrder({
    required List<Map<String, dynamic>> items,
    String? couponCode,
  }) async => Map<String, dynamic>.from(
    await request(
      'POST',
      'orders/quote',
      body: {'items': items, if (couponCode != null) 'couponCode': couponCode},
    ),
  );

  Future<Map<String, dynamic>?> _placeOrder(
    String path, {
    required List<Map<String, dynamic>> items,
    required String fullName,
    required String phone,
    required String street,
    required String city,
    required String region,
    required String postalCode,
    required String email,
    String? couponCode,
    required num expectedTotal,
    required String idempotencyKey,
  }) async {
    await ensureAuthSession();
    return Map<String, dynamic>.from(
      await request(
        'POST',
        path,
        key: idempotencyKey,
        body: {
          'items': items,
          'shippingAddress': {
            'fullName': fullName,
            'phone': phone
                .replaceAll(RegExp(r'\D'), '')
                .replaceFirst(RegExp(r'^91(?=\d{10}$)'), ''),
            'street': street,
            'city': city,
            'state': region,
            'postalCode': postalCode,
            'email': email,
          },
          if (couponCode != null) 'couponCode': couponCode,
          'expectedTotal': expectedTotal,
        },
      ),
    );
  }

  Future<Map<String, dynamic>?> placeCodOrder({
    required List<Map<String, dynamic>> items,
    required String fullName,
    required String phone,
    required String street,
    required String city,
    required String region,
    required String postalCode,
    required String email,
    String? couponCode,
    required num expectedTotal,
    required String idempotencyKey,
  }) => _placeOrder(
    'orders/cod-order',
    items: items,
    fullName: fullName,
    phone: phone,
    street: street,
    city: city,
    region: region,
    postalCode: postalCode,
    email: email,
    couponCode: couponCode,
    expectedTotal: expectedTotal,
    idempotencyKey: idempotencyKey,
  );
  Future<Map<String, dynamic>?> createRazorpayOrder({
    required List<Map<String, dynamic>> items,
    required String fullName,
    required String phone,
    required String street,
    required String city,
    required String region,
    required String postalCode,
    required String email,
    String? couponCode,
    required num expectedTotal,
    required String idempotencyKey,
  }) => _placeOrder(
    'orders/razorpay/create-order',
    items: items,
    fullName: fullName,
    phone: phone,
    street: street,
    city: city,
    region: region,
    postalCode: postalCode,
    email: email,
    couponCode: couponCode,
    expectedTotal: expectedTotal,
    idempotencyKey: idempotencyKey,
  );
  Future<Map<String, dynamic>?> verifyRazorpayPayment({
    required String orderId,
    required String razorpayOrderId,
    required String razorpayPaymentId,
    required String razorpaySignature,
  }) async => Map<String, dynamic>.from(
    await request(
      'POST',
      'orders/razorpay/verify',
      body: {
        'orderId': orderId,
        'razorpayOrderId': razorpayOrderId,
        'razorpayPaymentId': razorpayPaymentId,
        'razorpaySignature': razorpaySignature,
      },
    ),
  );
}
