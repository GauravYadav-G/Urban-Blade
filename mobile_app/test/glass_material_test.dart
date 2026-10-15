import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/core/widgets/glass_panel.dart';
import 'package:urban_blade_mobile/core/widgets/premium_scaffold.dart';

void main() {
  for (final dark in [false, true]) {
    for (final backdrop in [Colors.white, Colors.black]) {
      for (final blur in [true, false]) {
        testWidgets(
            '${blur ? 'frosted' : 'photo'} glass content contrast on $backdrop in ${dark ? 'dark' : 'light'} mode',
            (tester) async {
          final theme = dark ? AppTheme.darkTheme : AppTheme.lightTheme;
          await tester.pumpWidget(MaterialApp(
            theme: theme,
            home: Scaffold(
              body: ColoredBox(
                color: backdrop,
                child: Center(
                  child: GlassPanel(
                    blur: blur,
                    overImage: !blur,
                    padding: const EdgeInsets.all(24),
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Text('Your appointment',
                          style: theme.textTheme.titleLarge),
                      Text('Choose a date and time',
                          style: TextStyle(
                              color: theme.colorScheme.onSurfaceVariant)),
                    ]),
                  ),
                ),
              ),
            ),
          ));
          expect(find.byType(BackdropFilter),
              blur ? findsOneWidget : findsNothing);
          final semantics = tester.ensureSemantics();
          await expectLater(tester, meetsGuideline(textContrastGuideline));
          semantics.dispose();
          expect(tester.takeException(), isNull);
        });
      }
    }
  }

  for (final highContrast in [true, false]) {
    testWidgets(
        '${highContrast ? 'high contrast' : 'accessible navigation'} retains glass controls without blur',
        (tester) async {
      var taps = 0;
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
              highContrast: highContrast,
              accessibleNavigation: !highContrast,
              textScaler: const TextScaler.linear(2)),
          child: child!,
        ),
        home: PremiumScaffold(
          body: Center(
            child: GlassPanel(
              blur: true,
              padding: const EdgeInsets.all(16),
              child: FilledButton(
                onPressed: () => taps++,
                child: const Text('Continue'),
              ),
            ),
          ),
        ),
      ));
      expect(find.byType(BackdropFilter), findsNothing);
      await tester.tap(find.text('Continue'));
      expect(taps, 1);
      final semantics = tester.ensureSemantics();
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      semantics.dispose();
      expect(tester.takeException(), isNull);
    });
  }
}
