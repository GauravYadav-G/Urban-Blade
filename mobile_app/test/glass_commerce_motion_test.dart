import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/core/widgets/commerce_ui.dart';
import 'package:urban_blade_mobile/core/widgets/delivery_editor.dart';
import 'package:urban_blade_mobile/features/bookings/book_flow_screen.dart';
import 'package:urban_blade_mobile/features/cart/cart_sheet_host.dart';
import 'full_flow_preview_test.dart' show FlowPreviewApi, FlowPreviewState;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  for (final reduced in [false, true]) {
    testWidgets(
        'booking step motion keeps drafts and back actions (reduced $reduced)',
        (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final state = FlowPreviewState(FlowPreviewApi());
      await state.loadRemoteData();
      state.toggleServiceSelection('cut');
      await tester.pumpWidget(MaterialApp(
          theme: AppTheme.lightTheme,
          builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(disableAnimations: reduced),
              child: child!),
          home: Scaffold(
              body: AnimatedBuilder(
                  animation: state,
                  builder: (_, __) => BookFlowScreen(
                      state: state, onBookingComplete: () {})))));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Choose date & time'));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.text('10:00 AM'), 100,
          scrollable: find.byType(Scrollable).first);
      await tester.tap(find.text('10:00 AM'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Review appointment'));
      await tester.pump(const Duration(milliseconds: 60));
      expect(find.byTooltip('Previous step').hitTestable(), findsOneWidget);
      await tester.tap(find.byTooltip('Previous step'));
      await tester.pumpAndSettle();
      expect(state.selectedServiceIds, {'cut'});
      expect(state.selectedTimeSlot, '10:00 AM');
      expect(find.text('Find your moment.'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await state.persistDraft();
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    });
  }

  testWidgets(
      'cart frost stays inside the sheet and keeps the background interactive',
      (tester) async {
    final state = AppState(autoLoad: false);
    final host = GlobalKey<CartSheetHostState>();
    var taps = 0;
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
            body: CartSheetHost(
                key: host,
                state: state,
                onCheckout: () {},
                child: Center(
                    child: TextButton(
                        onPressed: () => taps++,
                        child: const Text('Background action')))))));
    host.currentState!.open();
    await tester.pumpAndSettle();
    expect(find.byType(ImageFiltered), findsNothing);
    expect(find.byType(CommerceSheetHeader), findsOneWidget);
    expect(find.byTooltip('Close cart').hitTestable(), findsOneWidget);
    await tester.tap(find.byTooltip('Close cart'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Background action'));
    expect(taps, 1);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });

  for (final size in [const Size(320, 568), const Size(568, 320)]) {
    testWidgets('glass delivery sheet saves a draft with a keyboard at $size',
        (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);
      final state = AppState(autoLoad: false);
      await state.saveDelivery(
          name: 'Alex Customer',
          phone: '9876543210',
          street: '12 Main Road',
          newCity: 'Pune',
          newRegion: 'Maharashtra',
          pin: '411001');
      await tester.pumpWidget(MaterialApp(
          theme: AppTheme.lightTheme,
          builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                  textScaler: const TextScaler.linear(2),
                  disableAnimations: true),
              child: child!),
          home: Scaffold(
              body: Builder(
                  builder: (context) => Center(
                      child: TextButton(
                          onPressed: () => editDeliveryAddress(context, state),
                          child: const Text('Delivery')))))));
      await tester.tap(find.text('Delivery'));
      await tester.pumpAndSettle();
      tester.view.viewInsets =
          FakeViewPadding(bottom: size.height < 400 ? 210 : 260);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Save delivery details'));
      await tester.pumpAndSettle();
      expect(find.text('Save delivery details').hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('Save delivery details'));
      await tester.pumpAndSettle();
      expect(find.text('Where should we deliver?'), findsNothing);
      expect(state.homeAddress, '12 Main Road');
      expect(state.postalCode, '411001');
      await state.persistDraft();
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    });
  }
}
