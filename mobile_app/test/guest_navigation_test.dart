import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/features/main_shell.dart';

void main() {
  testWidgets('Guest can explore all tabs without seeded catalog or login',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final originalHandler = FlutterError.onError;
    FlutterError.onError = (details) {
      FlutterError.dumpErrorToConsole(details);
      originalHandler?.call(details);
    };
    addTearDown(() => FlutterError.onError = originalHandler);
    final state = AppState(autoLoad: false);
    await tester.pumpWidget(MaterialApp(home: MainShell(state: state)));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    for (final index in [1, 2, 3, 4]) {
      await tester.tap(find.byKey(ValueKey('tab-$index')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    }
    expect(find.text('Sign in or create account'), findsOneWidget);
    expect(state.isLoggedIn, false);
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });
}
