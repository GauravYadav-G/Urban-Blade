import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:urban_blade_mobile/core/widgets/retained_tabs.dart';

void main() {
  testWidgets(
      'tabs build lazily and preserve input without rebuilding inactive pages',
      (tester) async {
    var index = 0;
    var firstBuilds = 0;
    var secondBuilds = 0;
    late StateSetter update;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(body: StatefulBuilder(builder: (context, setState) {
      update = setState;
      return RetainedTabs(index: index, builders: [
        (_) {
          firstBuilds++;
          return const TextField(key: ValueKey('draft'));
        },
        (_) {
          secondBuilds++;
          return const Text('Second page');
        },
      ]);
    }))));
    expect(firstBuilds, 1);
    expect(secondBuilds, 0);
    await tester.enterText(find.byType(TextField), 'Keep my draft');
    update(() => index = 1);
    await tester.pumpAndSettle();
    expect(firstBuilds, 1);
    expect(secondBuilds, 1);
    update(() {});
    await tester.pump();
    expect(firstBuilds, 1);
    update(() => index = 0);
    await tester.pumpAndSettle();
    expect(find.text('Keep my draft'), findsOneWidget);
    expect(secondBuilds, 2);
    expect(tester.takeException(), isNull);
  });
}
