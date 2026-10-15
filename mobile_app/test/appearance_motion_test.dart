import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/main.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/widgets/entrance.dart';
import 'package:urban_blade_mobile/features/home/home_screen.dart';
import 'package:urban_blade_mobile/features/main_shell.dart';
import 'visual_preview_test.dart' show PreviewApi;
import 'full_flow_preview_test.dart' show FlowPreviewApi;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test(
    'appearance defaults to light and persists independently of cart drafts',
    () async {
      final state = AppState(autoLoad: false);
      expect(state.themeMode, ThemeMode.light);
      await state.setThemeMode(ThemeMode.dark);
      await state.persistDraft();
      final restored = AppState(autoLoad: false);
      await restored.restoreAppearance();
      expect(restored.themeMode, ThemeMode.dark);
      await Future.wait([
        restored.setThemeMode(ThemeMode.light),
        restored.setThemeMode(ThemeMode.system),
      ]);
      final next = AppState(autoLoad: false);
      await next.restoreAppearance();
      expect(next.themeMode, ThemeMode.system);
      state.dispose();
      restored.dispose();
      next.dispose();
    },
  );

  testWidgets(
    'saved appearance covers every tab, product route and cart without losing state',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      for (final entry in {
        'PlusJakartaSans': 'assets/fonts/PlusJakartaSans.ttf',
        'CormorantGaramond': 'assets/fonts/CormorantGaramond.ttf',
        'MaterialIcons': 'fonts/MaterialIcons-Regular.otf',
      }.entries) {
        await (FontLoader(
          entry.key,
        )..addFont(rootBundle.load(entry.value))).load();
      }
      final state = AppState(api: FlowPreviewApi(), autoLoad: false);
      await state.loadRemoteData();
      await tester.pumpWidget(
        RepaintBoundary(
          key: const ValueKey('appearance-preview'),
          child: UrbanBladeMobileApp(appState: state),
        ),
      );
      for (final asset in [
        'assets/images/heroes/care-editorial.png',
        'assets/images/heroes/booking-home.png',
        'assets/images/heroes/booking-salon.png',
        'assets/images/heroes/hero-2.jpg',
        'assets/images/products/hc-shampoo.jpg',
        'assets/images/products/beard-oil.jpg',
        'assets/images/products/svc-mens-haircut.jpg',
      ]) {
        await tester.runAsync(
          () => precacheImage(
            AssetImage(asset),
            tester.element(find.byType(MainShell)),
          ),
        );
      }
      await tester.pumpAndSettle();
      Future<void> capture(String name) async {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 180)),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await expectLater(
          find.byKey(const ValueKey('appearance-preview')),
          matchesGoldenFile('goldens/$name.png'),
        );
      }

      expect(
        Theme.of(tester.element(find.byType(HomeScreen))).brightness,
        Brightness.light,
      );
      await capture('appearance-home-light');
      await state.setThemeMode(ThemeMode.dark);
      await tester.pumpAndSettle();
      expect(state.themeMode, ThemeMode.dark);
      expect(
        Theme.of(tester.element(find.byType(HomeScreen))).brightness,
        Brightness.dark,
      );
      await capture('appearance-home-dark');
      for (final tab in [1, 2, 3, 4]) {
        await tester.tap(find.byKey(ValueKey('tab-$tab')));
        await tester.pumpAndSettle();
        expect(
          Theme.of(tester.element(find.byType(MainShell))).brightness,
          Brightness.dark,
        );
        await capture('appearance-tab-$tab-dark');
        if (tab == 2) {
          state.toggleServiceSelection(state.services.first.id);
          await tester.pumpAndSettle();
          await tester.tap(find.text('Choose date & time'));
          await tester.pumpAndSettle();
          expect(find.text('Find your moment.'), findsOneWidget);
          expect(find.text('10:00 AM'), findsOneWidget);
          expect(tester.takeException(), isNull);
        }
      }
      await tester.scrollUntilVisible(find.text('System'), 200, scrollable: find.byType(Scrollable).first);
    await tester.ensureVisible(find.text('System'));
      await tester.pumpAndSettle();
      tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
      addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
      await tester.tap(find.text('System'));
      await tester.pumpAndSettle();
      expect(state.themeMode, ThemeMode.system);
      tester.platformDispatcher.platformBrightnessTestValue = Brightness.light;
      await tester.pumpAndSettle();
      expect(
        Theme.of(tester.element(find.byType(MainShell))).brightness,
        Brightness.light,
      );
      await state.setThemeMode(ThemeMode.dark);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('tab-3')));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Beard Oil'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Beard Oil'));
      await tester.pump(const Duration(milliseconds: 150));
      expect(tester.takeException(), isNull);
      await tester.pumpAndSettle();
      await capture('appearance-product-dark');
      await tester.tap(find.text('Add to bag'));
      await tester.pumpAndSettle();
      expect(state.cartCount, 1);
      await tester.tap(find.byTooltip('Shopping cart'));
      await tester.pumpAndSettle();
      await capture('appearance-cart-dark');
      await tester.tap(find.byTooltip('Close cart'));
      await tester.pumpAndSettle();
      await state.setThemeMode(ThemeMode.light);
      await tester.pumpAndSettle();
      expect(state.themeMode, ThemeMode.light);
      await tester.tap(find.byTooltip('Shopping cart'));
      await tester.pumpAndSettle();
      expect(state.cartCount, 1);
      expect(state.cartSubtotal, 449);
      await capture('appearance-cart-light');
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      await state.persistDraft();
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    },
  );

  testWidgets('dashboard actions and image categories retain navigation', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final state = AppState(api: PreviewApi(), autoLoad: false);
    await state.loadRemoteData();
    await tester.pumpWidget(
      RepaintBoundary(
        key: const ValueKey('cards-preview'),
        child: UrbanBladeMobileApp(appState: state),
      ),
    );
    await tester.pumpAndSettle();
    for (final mode in ['home', 'studio', 'services']) {
      final card = find.byKey(ValueKey('home-card-$mode'));
      await tester.scrollUntilVisible(
        card,
        240,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(card);
      await tester.pumpAndSettle();
      expect(card.hitTestable(), findsOneWidget);
      if (mode == 'home') {
        await expectLater(
          find.byKey(const ValueKey('cards-preview')),
          matchesGoldenFile('goldens/restored-home-cards.png'),
        );
        await state.setThemeMode(ThemeMode.dark);
        await tester.pumpAndSettle();
        await expectLater(
          find.byKey(const ValueKey('cards-preview')),
          matchesGoldenFile('goldens/restored-home-cards-dark.png'),
        );
        await state.setThemeMode(ThemeMode.light);
        await tester.pumpAndSettle();
      }
      await tester.tap(card);
      await tester.pumpAndSettle();
      if (mode == 'home' || mode == 'studio') expect(state.locationMode, mode);
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(const ValueKey('tab-0')));
      await tester.pumpAndSettle();
    }
    final category = find.byKey(const ValueKey('home-category-hair'));
    await tester.scrollUntilVisible(
      category,
      260,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(category);
    await tester.pumpAndSettle();
    await expectLater(
      find.byKey(const ValueKey('cards-preview')),
      matchesGoldenFile('goldens/restored-home-categories.png'),
    );
    await tester.tap(category);
    await tester.pumpAndSettle();
    expect(find.text('1 essentials'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });

  testWidgets(
    'dark mode fits small and landscape screens at large text sizes',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final state = AppState(api: PreviewApi(), autoLoad: false);
      await state.loadRemoteData();
      await state.setThemeMode(ThemeMode.dark);
      for (final size in [const Size(320, 720), const Size(800, 400)]) {
        tester.view.physicalSize = size;
        await tester.pumpWidget(UrbanBladeMobileApp(appState: state));
        await tester.pumpAndSettle();
        for (final tab in [0, 1, 2, 3, 4]) {
          await tester.tap(find.byKey(ValueKey('tab-$tab')));
          await tester.pumpAndSettle();
          expect(
            tester.takeException(),
            isNull,
            reason: 'Dark tab $tab at $size must fit',
          );
        }
        await tester.pumpWidget(const SizedBox());
      }
      await state.persistDraft();
      state.dispose();
    },
  );

  testWidgets('staggered entrances animate and respect reduced motion', (
    tester,
  ) async {
    Widget host(bool reduced) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(disableAnimations: reduced),
        child: const Scaffold(
          body: Entrance(order: 2, child: Text('Motion preview')),
        ),
      ),
    );
    await tester.pumpWidget(host(false));
    final opacity = find.descendant(
      of: find.byType(Entrance),
      matching: find.byType(FadeTransition),
    );
    expect(tester.widget<FadeTransition>(opacity).opacity.value, 0);
    await tester.pump(const Duration(milliseconds: 300));
    expect(
      tester.widget<FadeTransition>(opacity).opacity.value,
      greaterThan(0),
    );
    expect(tester.widget<FadeTransition>(opacity).opacity.value, lessThan(1));
    await tester.pumpAndSettle();
    expect(tester.widget<FadeTransition>(opacity).opacity.value, 1);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(host(true));
    expect(tester.widget<FadeTransition>(opacity).opacity.value, 1);
    expect(await tester.pumpAndSettle(), lessThan(3));
  });
}
