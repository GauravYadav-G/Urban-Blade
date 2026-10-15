import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/models/service_model.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/features/bookings/book_flow_screen.dart';
import 'full_flow_preview_test.dart' show FlowPreviewApi;

class _LargeServiceApi extends FlowPreviewApi {
  @override
  Future<List<ServiceModel>> fetchServices() async => List.generate(
      100,
      (index) => ServiceModel(
          id: 'service-$index',
          name: 'Treatment $index',
          duration: '45 min',
          price: 499,
          description: '',
          category: 'hair'));
}

void main() {
  testWidgets(
      '100 booking services build near the viewport and preserve navigation',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final state = AppState(api: _LargeServiceApi(), autoLoad: false);
    await state.loadRemoteData();
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
            body: AnimatedBuilder(
                animation: state,
                builder: (_, __) =>
                    BookFlowScreen(state: state, onBookingComplete: () {})))));
    await tester.pumpAndSettle();
    int mountedServices() => find
        .byWidgetPredicate((widget) =>
            widget.key is ValueKey<String> &&
            (widget.key! as ValueKey<String>)
                .value
                .startsWith('booking-service-'))
        .evaluate()
        .length;
    expect(mountedServices(), inInclusiveRange(1, 15));
    expect(find.text('Treatment 99'), findsNothing);
    await tester.scrollUntilVisible(find.text('Treatment 40'), 250,
        scrollable: find.byType(Scrollable).first);
    await tester.pumpAndSettle();
    expect(mountedServices(), lessThan(16));
    expect(find.text('Treatment 0'), findsNothing);
    await tester.tap(find.text('Treatment 40'));
    await tester.pumpAndSettle();
    expect(state.selectedServiceIds, {'service-40'});
    await tester.tap(find.text('Choose date & time'));
    await tester.pumpAndSettle();
    expect(find.text('Find your moment.'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('10:00 AM'), 100,
        scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('10:00 AM'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Review appointment'));
    await tester.pumpAndSettle();
    expect(find.text('Everything look right?'), findsOneWidget);
    expect(find.text('Treatment 40'), findsOneWidget);
    expect(state.selectedTimeSlot, '10:00 AM');
    expect(state.selectedServiceIds, {'service-40'});
    expect(tester.takeException(), isNull);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });
}
