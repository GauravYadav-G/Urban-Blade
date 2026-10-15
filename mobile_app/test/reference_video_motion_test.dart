import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/core/widgets/entrance.dart';
import 'package:urban_blade_mobile/core/widgets/retained_tabs.dart';

Finder get activeFilters => find
    .byWidgetPredicate((widget) => widget is ImageFiltered && widget.enabled);

void main() {
  testWidgets(
      'reference reveal sharpens and leaves no active blur after settling',
      (tester) async {
    var builds = 0;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: Entrance(
                order: 2,
                soften: true,
                child: Builder(builder: (_) {
                  builds++;
                  return const Text('Care collection');
                })))));
    expect(activeFilters, findsOneWidget);
    await tester.pump(const Duration(milliseconds: 160));
    expect(activeFilters, findsOneWidget);
    await tester.pumpAndSettle();
    expect(activeFilters, findsNothing);
    expect(builds, 1);
    expect(tester.hasRunningAnimations, isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('reduced motion skips defocus and translation immediately',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: MediaQuery(
            data: const MediaQueryData(disableAnimations: true),
            child: const Scaffold(
                body: Entrance(order: 3, child: Text('Care collection'))))));
    expect(activeFilters, findsNothing);
    expect(
        tester
            .widget<FadeTransition>(find.descendant(
                of: find.byType(Entrance),
                matching: find.byType(FadeTransition)))
            .opacity
            .value,
        1);
    expect(await tester.pumpAndSettle(), lessThan(3));
    expect(tester.takeException(), isNull);
  });

  testWidgets('tab rise replays on selection while preserving the input draft',
      (tester) async {
    var index = 0;
    late StateSetter update;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(body: StatefulBuilder(builder: (context, setState) {
      update = setState;
      return RetainedTabs(index: index, builders: [
        (_) => const TextField(key: ValueKey('retained-draft')),
        (_) => const Center(child: Text('Collection')),
      ]);
    }))));
    await tester.enterText(find.byType(TextField), 'Keep this appointment');
    update(() => index = 1);
    await tester.pump();
    final slide = find.descendant(
        of: find.byType(RetainedTabs), matching: find.byType(SlideTransition));
    expect(tester.widget<SlideTransition>(slide).position.value.dy,
        greaterThan(0));
    await tester.pumpAndSettle();
    expect(tester.widget<SlideTransition>(slide).position.value, Offset.zero);
    update(() => index = 0);
    await tester.pumpAndSettle();
    expect(find.text('Keep this appointment'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'Android navigation uses compositor movement and supports returning',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme.copyWith(platform: TargetPlatform.android),
        home: Builder(
            builder: (context) => Scaffold(
                body: TextButton(
                    onPressed: () => Navigator.push<void>(
                        context,
                        MaterialPageRoute(
                            builder: (_) => const Scaffold(
                                body: Center(child: Text('Detail'))))),
                    child: const Text('Open detail'))))));
    await tester.tap(find.text('Open detail'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(activeFilters, findsNothing);
    await tester.pumpAndSettle();
    expect(activeFilters, findsNothing);
    expect(find.text('Detail'), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Open detail').hitTestable(), findsOneWidget);
    expect(activeFilters, findsNothing);
    expect(tester.takeException(), isNull);
  });
}
