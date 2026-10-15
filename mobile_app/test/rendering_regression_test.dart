import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/models/service_model.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/core/widgets/stitch_image.dart';
import 'package:urban_blade_mobile/core/widgets/premium_scaffold.dart';
import 'package:urban_blade_mobile/features/services/services_screen.dart';
import 'visual_preview_test.dart' show PreviewApi;

class LargeCatalog extends PreviewApi {
  @override
  Future<List<ServiceModel>> fetchServices() async => List.generate(
      100,
      (i) => ServiceModel(
          id: '$i',
          name: 'Service $i',
          duration: '30 min',
          price: 249,
          description: '',
          category: 'hair'));
}

void main() {
  testWidgets('small image cards decode at the card size, not the phone width',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
            body: Center(
                child: SizedBox(
                    width: 120,
                    height: 120,
                    child: StitchImage(
                        imageUrl: 'assets/images/heroes/booking-home.png'))))));
    final provider =
        tester.widget<Image>(find.byType(Image)).image as ResizeImage;
    expect(provider.width, (120 * tester.view.devicePixelRatio).ceil());
    expect(tester.takeException(), isNull);
  });

  testWidgets('dragging a card does not start a press animation',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: ListView(children: [
      PressScale(
          child: SizedBox(
              height: 300,
              child: InkWell(onTap: () {}, child: const Text('Card')))),
      const SizedBox(height: 1000),
    ]))));
    final pointer =
        await tester.startGesture(tester.getCenter(find.text('Card')));
    await pointer.moveBy(const Offset(0, -80));
    await tester.pump(const Duration(milliseconds: 120));
    expect(tester.widget<AnimatedScale>(find.byType(AnimatedScale)).scale, 1);
    await pointer.up();
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'large service catalogs mount only nearby cards and retain selection',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    final state = AppState(api: LargeCatalog(), autoLoad: false);
    await state.loadRemoteData();
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
            body: ServicesScreen(state: state, onProceedToBooking: () {}))));
    await tester.pumpAndSettle();
    expect(find.byType(StitchImage).evaluate().length, lessThan(10));
    expect(find.text('Service 99'), findsNothing);
    await tester.ensureVisible(find.text('Service 0'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Service 0'));
    // This test hosts the page alone; MainShell normally listens to this state.
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
            body: ServicesScreen(state: state, onProceedToBooking: () {}))));
    await tester.pumpAndSettle();
    expect(state.selectedServiceIds, contains('0'));
    expect(find.text('Book 1 service · ₹249').hitTestable(), findsOneWidget);
    await state.persistDraft();
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });
}
