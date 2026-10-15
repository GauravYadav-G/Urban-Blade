import 'dart:typed_data';
import 'package:dynamic_color/dynamic_color.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/main.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/core/widgets/stitch_image.dart';
import 'package:urban_blade_mobile/features/cart/cart_flow.dart';
import 'package:urban_blade_mobile/features/cart/cart_screen.dart';
import 'visual_preview_test.dart' show PreviewApi;

// The native channel returns five tonal palettes in ascending tone order.
List<int> platformPalette(double hue) => [
      for (final saturation in [.6, .3, .4, .05, .1])
        for (final tone in [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100])
          HSLColor.fromAHSL(1, hue, saturation, tone / 100)
              .toColor()
              .toARGB32(),
    ];

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
      'wallpaper palette refreshes on resume without closing or resizing the cart',
      (tester) async {
    var palette = platformPalette(140);
    var requests = 0;
    tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(DynamicColorPlugin.channel, (call) async {
      expect(call.method, 'getCorePalette');
      requests++;
      return Int32List.fromList(palette);
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(DynamicColorPlugin.channel, null));
    final state = AppState(api: PreviewApi(), autoLoad: false);
    await state.loadRemoteData();
    state.addToCart(state.products.first);
    await tester.pumpWidget(UrbanBladeMobileApp(appState: state));
    await tester.pumpAndSettle();
    ColorScheme scheme() =>
        tester.widget<MaterialApp>(find.byType(MaterialApp)).theme!.colorScheme;
    expect(scheme().primary, Color(palette[4]));
    final greenSurface = scheme().surfaceContainerLow;
    await tester.tap(find.byKey(const ValueKey('tab-3')));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(CartDock).hitTestable());
    await tester.pumpAndSettle();
    final thumbnail = find
        .descendant(
            of: find.byType(CartScreen), matching: find.byType(StitchImage))
        .first;
    final before = tester.getRect(thumbnail);
    final cartState = tester.state(find.byType(CartScreen));
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    palette = platformPalette(220);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(requests, greaterThanOrEqualTo(2));
    expect(scheme().primary, Color(palette[4]));
    expect(scheme().surfaceContainerLow, isNot(greenSurface));
    expect(find.text('My cart'), findsOneWidget);
    expect(identical(cartState, tester.state(find.byType(CartScreen))), isTrue);
    expect(tester.getRect(thumbnail), before);
    expect(state.cartCount, 1);
    await state.setThemeMode(ThemeMode.dark);
    await tester.pumpAndSettle();
    expect(
        tester
            .widget<MaterialApp>(find.byType(MaterialApp))
            .darkTheme!
            .colorScheme
            .primary,
        Color(palette[8]));
    expect(tester.getRect(thumbnail), before);
    // An already-open frosted Home sheet must refresh its sampled tint.
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    await tester.tap(find.byType(CartDock).hitTestable());
    await tester.pumpAndSettle();
    expect(find.text('My cart'), findsOneWidget);
    final surface = find.byKey(const ValueKey('home-cart-surface'));
    Color glassTint() {
      final ink = tester.widget<Ink>(
          find.descendant(of: surface, matching: find.byType(Ink)).first);
      return (ink.decoration! as BoxDecoration).gradient!.colors[1];
    }

    final oldTint = glassTint();
    expect(tester.widget<Material>(surface).color, Colors.transparent);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    palette = platformPalette(20);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(find.text('My cart'), findsOneWidget);
    expect(glassTint(), isNot(oldTint));
    expect(glassTint().a, lessThan(1));
    expect(tester.widget<Material>(surface).color, Colors.transparent);
    expect(tester.takeException(), isNull);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });

  testWidgets(
      'unsupported devices retain brand theme and platform failures are safe',
      (tester) async {
    var fail = false;
    tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(DynamicColorPlugin.channel, (_) async {
      if (fail) throw PlatformException(code: 'unavailable');
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(DynamicColorPlugin.channel, null));
    final state = AppState(autoLoad: false);
    await tester.pumpWidget(UrbanBladeMobileApp(appState: state));
    await tester.pumpAndSettle();
    expect(tester.widget<MaterialApp>(find.byType(MaterialApp)).theme,
        AppTheme.lightTheme);
    fail = true;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(tester.widget<MaterialApp>(find.byType(MaterialApp)).theme,
        AppTheme.lightTheme);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });
}
