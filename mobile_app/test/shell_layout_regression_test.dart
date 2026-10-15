import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/core/widgets/retained_tabs.dart';
import 'package:urban_blade_mobile/core/widgets/stitch_bottom_nav.dart';
import 'package:urban_blade_mobile/features/main_shell.dart';
import 'visual_preview_test.dart' show PreviewApi;

void main() {
  for (final size in [
    const Size(320, 720),
    const Size(412, 915),
    const Size(800, 400)
  ]) {
    for (final scale in [1.0, 2.0]) {
      testWidgets('shell actions clear navigation at $size / text $scale',
          (tester) async {
        SharedPreferences.setMockInitialValues({});
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final state = AppState(api: PreviewApi(), autoLoad: false);
        await state.loadRemoteData();
        state.addToCart(state.products.first);
        state.toggleServiceSelection(state.services.first.id);
        await tester.pumpWidget(MaterialApp(
            theme: AppTheme.lightTheme,
            builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context)
                    .copyWith(textScaler: TextScaler.linear(scale)),
                child: child!),
            home: MainShell(state: state)));
        await tester.pumpAndSettle();
        for (final tab in [0, 1, 2, 3, 4]) {
          await tester.tap(find.byKey(ValueKey('tab-$tab')));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull,
              reason: 'Tab $tab must not overflow');
          final content = tester.getRect(find.byType(RetainedTabs));
          final dock = tester.getRect(find.byType(StitchBottomNav));
          expect(content.bottom, lessThanOrEqualTo(dock.top + .1),
              reason: 'Tab $tab must never lay out content behind the dock');
          if (tab == 1) {
            final action =
                find.widgetWithText(FilledButton, 'Book 1 service · ₹249');
            expect(action.hitTestable(), findsOneWidget);
            expect(tester.getRect(action).bottom, lessThanOrEqualTo(dock.top));
          }
          if (tab == 3) {
            expect(find.text('Cart').hitTestable(), findsOneWidget);
            expect(tester.getRect(find.text('Cart')).bottom,
                lessThan(dock.top));
          }
        }
        await state.persistDraft();
        await tester.pumpWidget(const SizedBox());
        state.dispose();
      });
    }
  }
  testWidgets(
      'shop keyboard preserves search without crowding it with the dock',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(360, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetViewInsets);
    final state = AppState(api: PreviewApi(), autoLoad: false);
    await state.loadRemoteData();
    state.addToCart(state.products.first);
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: MainShell(state: state, initialTab: 3)));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Beard');
    tester.view.viewInsets = const FakeViewPadding(bottom: 280);
    await tester.pumpAndSettle();
    expect(find.byType(StitchBottomNav), findsNothing);
    expect(
        tester.widget<EditableText>(find.byType(EditableText)).controller.text,
        'Beard');
    expect(tester.takeException(), isNull);
    tester.view.resetViewInsets();
    await tester.pumpAndSettle();
    expect(find.byType(StitchBottomNav), findsOneWidget);
    expect(
        tester.widget<EditableText>(find.byType(EditableText)).controller.text,
        'Beard');
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });
}
