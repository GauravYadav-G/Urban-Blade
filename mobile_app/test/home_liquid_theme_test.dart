import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:urban_blade_mobile/core/widgets/repository_glass.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/core/widgets/glass_panel.dart';
import 'package:urban_blade_mobile/core/widgets/premium_scaffold.dart';
import 'package:urban_blade_mobile/features/home/ritual_dashboard.dart';

void main() {
  for (final brightness in Brightness.values) {
    for (final highContrast in [false, true]) {
      testWidgets(
        'dashboard follows $brightness with highContrast=$highContrast',
        (tester) async {
          final theme = brightness == Brightness.dark
              ? AppTheme.darkTheme
              : AppTheme.lightTheme;
          var selected = 0;
          await tester.pumpWidget(
            MaterialApp(
              theme: theme,
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(
                  context,
                ).copyWith(highContrast: highContrast),
                child: child!,
              ),
              home: PremiumScaffold(
                body: SingleChildScrollView(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: RitualDashboard(
                      greeting: 'Good to see you.',
                      onServices: () => selected++,
                      onStudio: () {},
                      onHome: () {},
                      onBook: () {},
                    ),
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          final booking = find.byKey(const ValueKey('home-card-services'));
          final glass = tester.widget<GlassPanel>(booking);
          expect(glass.liquid, isTrue);
          expect(glass.tint, theme.colorScheme.primaryContainer);
          expect(
            find.byType(RepositoryGlass),
            highContrast ? findsNothing : findsNWidgets(4),
          );
          final icon = tester.widget<Icon>(
            find.byIcon(Icons.content_cut_rounded),
          );
          expect(icon.color, theme.colorScheme.primary);
          final cta = tester.widget<Text>(find.text('Choose a service'));
          expect(cta.style!.color, theme.colorScheme.onPrimary);
          await tester.tap(booking);
          expect(selected, 1);
          final semantics = tester.ensureSemantics();
          await expectLater(tester, meetsGuideline(textContrastGuideline));
          semantics.dispose();
          expect(tester.takeException(), isNull);
        },
      );
    }
  }
}
