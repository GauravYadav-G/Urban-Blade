import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/features/home/ritual_dashboard.dart';

void main() {
  for (final width in [360.0, 393.0, 412.0]) {
    for (final scale in [1.0, 1.3, 1.6]) {
      testWidgets(
          'Home cards align and remain tappable at width $width, text $scale',
          (tester) async {
        SharedPreferences.setMockInitialValues({});
        tester.view.physicalSize = Size(width, 851);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await (FontLoader('PlusJakartaSans')
              ..addFont(rootBundle.load('assets/fonts/PlusJakartaSans.ttf')))
            .load();
        await (FontLoader('CormorantGaramond')
              ..addFont(rootBundle.load('assets/fonts/CormorantGaramond.ttf')))
            .load();
        var services = 0;
        await tester.pumpWidget(MaterialApp(
            theme: AppTheme.lightTheme,
            builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context)
                    .copyWith(textScaler: TextScaler.linear(scale)),
                child: child!),
            home: Scaffold(
                body: SingleChildScrollView(
                    child: Padding(
                        padding: const EdgeInsets.all(20),
                        child: RitualDashboard(
                            greeting: 'Good to see you.',
                            onBook: () {},
                            onServices: () => services++,
                            onStudio: () {},
                            onHome: () {}))))));
        await tester.pumpAndSettle();
        final booking =
            tester.getRect(find.byKey(const ValueKey('home-card-services')));
        final studio =
            tester.getRect(find.byKey(const ValueKey('home-card-studio')));
        final home =
            tester.getRect(find.byKey(const ValueKey('home-card-home')));
        if (scale <= 1.5) {
          expect(booking.top, closeTo(studio.top, .01));
          expect(booking.bottom, closeTo(home.bottom, .01));
        } else {
          expect(studio.top, greaterThan(booking.bottom));
        }
        for (final rect in [booking, studio, home]) {
          expect(rect.left, greaterThanOrEqualTo(20));
          expect(rect.right, lessThanOrEqualTo(width - 20));
        }
        final card = find.byKey(const ValueKey('home-card-services'));
        await tester.ensureVisible(card);
        await tester.pumpAndSettle();
        await tester.tap(card);
        expect(services, 1);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      });
    }
  }
}
