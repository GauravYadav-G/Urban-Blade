import 'package:flutter/material.dart';
import 'package:urban_blade_mobile/core/models/address_model.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/services/api_service.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/models/product_model.dart';
import 'package:urban_blade_mobile/core/models/service_model.dart';
import 'package:urban_blade_mobile/core/models/barber_model.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/features/main_shell.dart';
import 'package:urban_blade_mobile/features/auth/login_screen.dart';

class PreviewApi extends ApiService {
  @override
  Future<List<SavedAddress>> fetchAddresses() async => [];
  @override
  Future<List<ProductModel>> fetchProducts(
          {int page = 1, int limit = 100}) async =>
      [
        const ProductModel(
            id: 'oil',
            name: 'Beard Oil',
            price: 449,
            compareAtPrice: 599,
            imageUrl: 'assets/images/products/beard-oil.jpg',
            category: 'beard',
            description:
                'Softens coarse beards with a clean sandalwood scent.'),
        const ProductModel(
            id: 'shampoo',
            name: 'Daily Care Shampoo',
            price: 349,
            imageUrl: 'assets/images/products/hc-shampoo.jpg',
            category: 'hair',
            description: 'A fresh start for your hair.'),
      ];
  @override
  Future<List<ServiceModel>> fetchServices() async => [
        const ServiceModel(
            id: 'cut',
            name: "Men’s Precision Haircut",
            duration: '30 min',
            price: 249,
            description: 'Wash, cut and finish.',
            category: 'hair',
            imageUrl: 'assets/images/products/svc-mens-haircut.jpg')
      ];
  @override
  Future<List<BarberModel>> fetchStylists() async => [
        const BarberModel(
            id: 'stylist',
            name: 'Your stylist',
            title: 'Hair specialist',
            avatarUrl: '',
            experience: '',
            bio: '')
      ];
}

void main() {
  testWidgets('phone screen visual regression', (tester) async {
    SharedPreferences.setMockInitialValues({});
    debugDisableShadows = false;
    addTearDown(() => debugDisableShadows = true);
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final loader = FontLoader('PlusJakartaSans')
      ..addFont(rootBundle.load('assets/fonts/PlusJakartaSans.ttf'));
    await loader.load();
    final serif = FontLoader('CormorantGaramond')
      ..addFont(rootBundle.load('assets/fonts/CormorantGaramond.ttf'));
    await serif.load();
    final icons = FontLoader('MaterialIcons')
      ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
    await icons.load();
    final state = AppState(api: PreviewApi(), autoLoad: false);
    await state.loadRemoteData();
    await tester.pumpWidget(RepaintBoundary(
        key: const ValueKey('capture'),
        child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: AppTheme.lightTheme,
            home: MainShell(state: state))));
    for (final asset in [
      'assets/images/heroes/slide-hair.png',
      'assets/images/heroes/care-editorial.png',
      'assets/images/heroes/hero-2.jpg',
      'assets/images/heroes/booking-home.png',
      'assets/images/heroes/booking-salon.png',
      'assets/images/products/beard-oil.jpg',
      'assets/images/products/hc-shampoo.jpg',
      'assets/images/products/svc-mens-haircut.jpg'
    ]) {
      await tester.runAsync(() => precacheImage(
          AssetImage(asset), tester.element(find.byType(MainShell))));
    }
    await tester.pumpAndSettle();
    for (final entry in {
      0: 'home',
      1: 'services',
      2: 'booking',
      3: 'shop',
      4: 'profile'
    }.entries) {
      await tester.tap(find.byKey(ValueKey('tab-${entry.key}')));
      await tester.pumpAndSettle();
      await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 180)));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await expectLater(find.byKey(const ValueKey('capture')),
          matchesGoldenFile('goldens/${entry.value}.png'));
    }
    await tester.tap(find.byKey(const ValueKey('tab-3')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Beard Oil'));
    await tester.pumpAndSettle();
    await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 180)));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await expectLater(find.byKey(const ValueKey('capture')),
        matchesGoldenFile('goldens/product-details.png'));
    await tester.pageBack();
    await tester.pumpAndSettle();
    state.addToCart(state.products.first);
    await tester.tap(find.byTooltip('Shopping cart'));
    await tester.pumpAndSettle();
    await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 180)));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(
        find.byKey(const ValueKey('plus-oil')).hitTestable(), findsOneWidget);
    await expectLater(find.byKey(const ValueKey('capture')),
        matchesGoldenFile('goldens/cart.png'));
    await tester.pumpWidget(RepaintBoundary(
        key: const ValueKey('capture'),
        child: MaterialApp(
            key: const ValueKey('login-app'),
            debugShowCheckedModeBanner: false,
            theme: AppTheme.lightTheme,
            home: LoginScreen(state: state, onLoginSuccess: () {}))));
    await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 180)));
    await tester.pumpAndSettle();
    await expectLater(find.byKey(const ValueKey('capture')),
        matchesGoldenFile('goldens/login.png'));
    await tester.ensureVisible(find.text('New here? Create an account'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('New here? Create an account'));
    await tester.pumpAndSettle();
    await expectLater(find.byKey(const ValueKey('capture')),
        matchesGoldenFile('goldens/register.png'));
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
    debugDisableShadows = true;
  });
}
