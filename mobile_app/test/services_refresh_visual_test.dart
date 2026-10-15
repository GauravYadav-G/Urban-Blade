import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/features/services/services_screen.dart';
import 'visual_preview_test.dart' show PreviewApi;

void main() {
  for (final dark in [false, true]) {
    testWidgets('service menu in ${dark ? 'dark' : 'light'} appearance',
        (tester) async {
      SharedPreferences.setMockInitialValues({});
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      for (final entry in {
        'PlusJakartaSans': 'assets/fonts/PlusJakartaSans.ttf',
        'CormorantGaramond': 'assets/fonts/CormorantGaramond.ttf',
        'MaterialIcons': 'fonts/MaterialIcons-Regular.otf'
      }.entries) {
        await (FontLoader(entry.key)..addFont(rootBundle.load(entry.value)))
            .load();
      }
      final state = AppState(api: PreviewApi(), autoLoad: false);
      await state.loadRemoteData();
      await tester.pumpWidget(RepaintBoundary(
          key: const ValueKey('services-preview'),
          child: MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: dark ? AppTheme.darkTheme : AppTheme.lightTheme,
              home: Scaffold(
                  appBar: AppBar(title: const Text('Grooming Services')),
                  body: ServicesScreen(
                      state: state, onProceedToBooking: () {})))));
      await tester.runAsync(() => precacheImage(
          const AssetImage('assets/images/products/svc-mens-haircut.jpg'),
          tester.element(find.byType(ServicesScreen))));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Men’s Precision Haircut'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await expectLater(
          find.byKey(const ValueKey('services-preview')),
          matchesGoldenFile(
              'goldens/services-refreshed-${dark ? 'dark' : 'light'}.png'));
      await state.persistDraft();
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    });
  }
}
