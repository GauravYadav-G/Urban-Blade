import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/core/widgets/stitch_bottom_nav.dart';

void main() {
  for (final dark in [false, true]) {
    final theme = dark ? AppTheme.darkTheme : AppTheme.lightTheme;
    test('Material 3 ${dark ? "dark" : "light"} semantic color contrast', () {
      expect(theme.useMaterial3, isTrue);
      final c = theme.colorScheme;
      for (final pair in [
        [c.primary, c.onPrimary],
        [c.surface, c.onSurface],
        [c.surfaceContainerLow, c.onSurfaceVariant],
        [c.secondaryContainer, c.onSecondaryContainer],
        [c.inverseSurface, c.onInverseSurface],
        [c.error, c.onError],
      ]) {
        final luminance = pair.map((c) => c.computeLuminance()).toList()
          ..sort();
        expect((luminance.last + .05) / (luminance.first + .05),
            greaterThanOrEqualTo(4.5));
      }
    });
    testWidgets(
        'Material navigation ${dark ? "dark" : "light"} touch targets and routes',
        (tester) async {
      var selected = -1;
      await tester.pumpWidget(MaterialApp(
          theme: theme,
          home: Scaffold(
              bottomNavigationBar: StitchBottomNav(
                  currentIndex: 0,
                  cartItemCount: 2,
                  onTap: (index) => selected = index))));
      expect(find.byType(StitchBottomNav), findsOneWidget);
      for (var index = 0; index < 5; index++) {
        expect(
            find.byKey(ValueKey('tab-$index')).hitTestable(), findsOneWidget);
      }
      final semantics = tester.ensureSemantics();
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      semantics.dispose();
      for (var i = 1; i < 5; i++) {
        await tester.tap(find.byKey(ValueKey('tab-$i')));
        expect(selected, i);
      }
    });
  }
}
