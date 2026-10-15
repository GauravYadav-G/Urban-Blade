import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/core/widgets/delivery_editor.dart';
import 'package:urban_blade_mobile/core/widgets/retained_tabs.dart';
import 'package:urban_blade_mobile/core/widgets/stitch_header.dart';
import 'package:urban_blade_mobile/features/main_shell.dart';

class DeliveryTestState extends AppState {
  DeliveryTestState() : super(autoLoad: false);

  final save = Completer<void>();
  int saves = 0;
  bool fail = false;

  @override
  Future<void> saveDelivery({
    required String name,
    required String phone,
    required String street,
    required String newCity,
    required String newRegion,
    required String pin,
  }) async {
    saves++;
    if (fail) throw StateError('Storage unavailable');
    await save.future;
  }
}

Future<void> openDelivery(WidgetTester tester, AppState state,
    {double scale = 1}) async {
  await tester.pumpWidget(MaterialApp(
    theme: AppTheme.lightTheme,
    builder: (context, child) => MediaQuery(
      data:
          MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
      child: child!,
    ),
    home: Scaffold(
      body: Builder(
        builder: (context) => TextButton(
          onPressed: () => editDeliveryAddress(context, state),
          child: const Text('Edit delivery'),
        ),
      ),
    ),
  ));
  await tester.tap(find.text('Edit delivery'));
  await tester.pumpAndSettle();
}

Future<void> fillDelivery(WidgetTester tester) async {
  const values = [
    'Avery Sharma',
    '9876543210',
    '12 Main Road',
    'Pune',
    'Maharashtra',
    '411001',
  ];
  for (var index = 0; index < values.length; index++) {
    final field = find.byType(TextFormField).at(index);
    await tester.ensureVisible(field);
    await tester.enterText(field, values[index]);
  }
  await tester.ensureVisible(find.text('Save delivery details'));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('inactive retained tabs relinquish their text-field focus',
      (tester) async {
    var index = 0;
    late StateSetter changeTab;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: StatefulBuilder(builder: (context, setState) {
          changeTab = setState;
          return RetainedTabs(index: index, builders: [
            (_) => const TextField(),
            (_) => const Text('Profile'),
          ]);
        }),
      ),
    ));
    await tester.tap(find.byType(TextField));
    await tester.enterText(find.byType(TextField), 'Saved search');
    final editable = tester.widget<EditableText>(find.byType(EditableText));
    expect(editable.focusNode.hasFocus, isTrue);
    changeTab(() => index = 1);
    await tester.pumpAndSettle();
    expect(editable.focusNode.hasFocus, isFalse);
    changeTab(() => index = 0);
    await tester.pumpAndSettle();
    expect(find.text('Saved search'), findsOneWidget);
    expect(editable.focusNode.hasFocus, isFalse);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('delivery save remains above the device gesture area',
      (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    tester.view.padding = const FakeViewPadding(bottom: 34);
    tester.view.viewPadding = const FakeViewPadding(bottom: 34);
    addTearDown(tester.view.reset);
    final state = AppState(autoLoad: false);
    addTearDown(state.dispose);
    await openDelivery(tester, state, scale: 2);
    await tester.ensureVisible(find.text('Save delivery details'));
    await tester.pumpAndSettle();
    final save = find.widgetWithText(FilledButton, 'Save delivery details');
    expect(tester.getRect(save).bottom, lessThanOrEqualTo(606));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('delivery save rejects repeat taps while storage is pending',
      (tester) async {
    final state = DeliveryTestState();
    addTearDown(state.dispose);
    await openDelivery(tester, state);
    await fillDelivery(tester);
    await tester.tap(find.text('Save delivery details'));
    await tester.pump();
    final button = tester.widget<FilledButton>(find.byType(FilledButton));
    expect(button.onPressed, isNull);
    expect(state.saves, 1);
    state.save.complete();
    await tester.pumpAndSettle();
    expect(find.byType(TextFormField), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('delivery form can scroll above the keyboard in landscape',
      (tester) async {
    tester.view.physicalSize = const Size(568, 320);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final state = AppState(autoLoad: false);
    addTearDown(state.dispose);
    await openDelivery(tester, state, scale: 2);
    tester.view.viewInsets = const FakeViewPadding(bottom: 220);
    await tester.pumpAndSettle();
    final save = find.widgetWithText(FilledButton, 'Save delivery details');
    await tester.ensureVisible(save);
    await tester.pumpAndSettle();
    expect(save.hitTestable(), findsOneWidget);
    expect(tester.getRect(save).bottom, lessThanOrEqualTo(100));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('delivery save failure keeps the form available for retry',
      (tester) async {
    final state = DeliveryTestState()..fail = true;
    addTearDown(state.dispose);
    await openDelivery(tester, state);
    await fillDelivery(tester);
    await tester.tap(find.text('Save delivery details'));
    await tester.pumpAndSettle();
    expect(find.text('Could not save your delivery details. Please try again.'),
        findsOneWidget);
    expect(tester.takeException(), isNull);
    state.fail = false;
    await tester.ensureVisible(find.text('Save delivery details'));
    await tester.tap(find.text('Save delivery details'));
    await tester.pump();
    expect(state.saves, 2);
    state.save.complete();
    await tester.pumpAndSettle();
    expect(find.byType(TextFormField), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('header fits a narrow device at accessibility text sizes',
      (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final state = AppState(autoLoad: false);
    addTearDown(state.dispose);
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.lightTheme,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context)
            .copyWith(textScaler: const TextScaler.linear(3)),
        child: child!,
      ),
      home: Scaffold(appBar: StitchHeader(state: state)),
    ));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.byTooltip('My profile').hitTestable(), findsOneWidget);
    expect(find.byTooltip('Shopping cart').hitTestable(), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('stacked sync errors leave room for the active tab in landscape',
      (tester) async {
    tester.view.physicalSize = const Size(640, 360);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final state = AppState(autoLoad: false)
      ..syncError = 'Cart could not sync. Please try again.'
      ..historyError = 'Your orders could not be refreshed. Please try again.'
      ..catalogError = 'The latest products could not be loaded. Please retry.';
    addTearDown(state.dispose);
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.lightTheme,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context)
            .copyWith(textScaler: const TextScaler.linear(2)),
        child: child!,
      ),
      home: MainShell(state: state, initialTab: 4),
    ));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(tester.getSize(find.byType(RetainedTabs)).height, greaterThan(100));
    expect(find.byKey(const ValueKey('tab-0')).hitTestable(), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
}
