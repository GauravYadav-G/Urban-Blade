import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/core/widgets/active_listenable_builder.dart';
import 'package:urban_blade_mobile/core/widgets/glass_panel.dart';
import 'package:urban_blade_mobile/core/widgets/stitch_bottom_nav.dart';
import 'package:urban_blade_mobile/features/main_shell.dart';
import 'visual_preview_test.dart' show PreviewApi;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  testWidgets(
      'hidden retained pages defer notifications and show fresh data on return',
      (tester) async {
    final value = ValueNotifier(0);
    addTearDown(value.dispose);
    var active = true, builds = 0;
    late StateSetter update;
    await tester.pumpWidget(
        MaterialApp(home: StatefulBuilder(builder: (context, setState) {
      update = setState;
      return TickerMode(
          enabled: active,
          child: ActiveListenableBuilder(
              animation: value,
              builder: (_, __) {
                builds++;
                return Text('Value ${value.value}');
              }));
    })));
    update(() => active = false);
    await tester.pump();
    final before = builds;
    value.value = 3;
    await tester.pump();
    expect(builds, before);
    update(() => active = true);
    await tester.pump();
    expect(find.text('Value 3'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'cart changes update badges without rebuilding home and service catalogs',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final state = AppState(api: PreviewApi(), autoLoad: false);
    addTearDown(state.dispose);
    await state.loadRemoteData();
    await tester.pumpWidget(
        MaterialApp(theme: AppTheme.lightTheme, home: MainShell(state: state)));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.search), findsNothing);
    final greeting = tester.widget(find.text('Good to see you.'));
    state.addToCart(state.products.first);
    await tester.pumpAndSettle();
    expect(identical(greeting, tester.widget(find.text('Good to see you.'))),
        isTrue);
    expect(
        tester
            .widget<StitchBottomNav>(find.byType(StitchBottomNav))
            .cartItemCount,
        1);
    await tester.tap(find.byKey(const ValueKey('tab-1')));
    await tester.pumpAndSettle();
    final treatment = tester.widget(find.text('Men’s Precision Haircut'));
    state.addToCart(state.products.first);
    await tester.pumpAndSettle();
    expect(
        identical(
            treatment, tester.widget(find.text('Men’s Precision Haircut'))),
        isTrue);
    expect(
        tester
            .widget<StitchBottomNav>(find.byType(StitchBottomNav))
            .cartItemCount,
        2);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('nested sheet controls reuse the containing backdrop pass',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: const Scaffold(
            body: Center(
                child: GlassPanel(
                    blur: true,
                    padding: EdgeInsets.all(20),
                    child: GlassPanel(
                        blur: true, child: Text('Shared frost')))))));
    expect(find.byType(BackdropFilter), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
