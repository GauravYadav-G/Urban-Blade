import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:urban_blade_mobile/core/services/app_state.dart';
import 'package:urban_blade_mobile/core/theme/app_theme.dart';
import 'package:urban_blade_mobile/core/widgets/stitch_bottom_nav.dart';
import 'package:urban_blade_mobile/core/widgets/stitch_header.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    await (FontLoader(
      'PlusJakartaSans',
    )..addFont(rootBundle.load('assets/fonts/PlusJakartaSans.ttf'))).load();
  });
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
    'selected pill icons meet contrast for brand and wallpaper colors',
    (tester) async {
      for (final theme in [
        AppTheme.lightTheme,
        AppTheme.darkTheme,
        for (final brightness in Brightness.values)
          AppTheme.fromColorScheme(
            ColorScheme.fromSeed(
              seedColor: const Color(0xFF426874),
              brightness: brightness,
            ),
          ),
      ]) {
        await tester.pumpWidget(
          MaterialApp(
            theme: theme,
            home: Scaffold(
              bottomNavigationBar: StitchBottomNav(
                currentIndex: 0,
                onTap: (_) {},
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final target = find.byKey(const ValueKey('tab-0'));
        final foreground = tester
            .widget<Icon>(
              find.descendant(
                of: target,
                matching: find.byIcon(Icons.home_rounded),
              ),
            )
            .color!;
        final background = tester
            .widget<Material>(
              find.descendant(of: target, matching: find.byType(Material)),
            )
            .color!;
        final luminance = [
          foreground.computeLuminance(),
          background.computeLuminance(),
        ]..sort();
        expect(
          (luminance.last + .05) / (luminance.first + .05),
          greaterThanOrEqualTo(3),
        );
      }
      await tester.pumpWidget(const SizedBox());
    },
  );

  for (final dark in [false, true]) {
    for (final size in [const Size(320, 720), const Size(640, 360)]) {
      testWidgets(
        'glass dock keeps touch targets and insets at $size / $dark',
        (tester) async {
          tester.view.physicalSize = size;
          tester.view.devicePixelRatio = 1;
          tester.view.padding = const FakeViewPadding(bottom: 34);
          tester.view.viewPadding = const FakeViewPadding(bottom: 34);
          addTearDown(tester.view.reset);
          final state = AppState(autoLoad: false);
          addTearDown(state.dispose);
          var selected = 0;
          final visits = <int>[];
          await tester.pumpWidget(
            MaterialApp(
              theme: dark ? AppTheme.darkTheme : AppTheme.lightTheme,
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(
                  context,
                ).copyWith(textScaler: const TextScaler.linear(2)),
                child: child!,
              ),
              home: StatefulBuilder(
                builder: (context, setState) => Scaffold(
                  appBar: StitchHeader(
                    state: state,
                    onProfile: () {},
                    onCart: () {},
                  ),
                  body: const Center(child: Text('Active tab')),
                  bottomNavigationBar: StitchBottomNav(
                    currentIndex: selected,
                    cartItemCount: 120,
                    onTap: (index) {
                      visits.add(index);
                      setState(() => selected = index);
                    },
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          final dock = tester.getRect(
            find.byKey(const ValueKey('glass-nav-surface')),
          );
          expect(dock.bottom, lessThanOrEqualTo(size.height - 34));
          for (var index = 0; index < 5; index++) {
            final target = find.byKey(ValueKey('tab-$index'));
            expect(target.hitTestable(), findsOneWidget);
            final rect = tester.getRect(target);
            expect(rect.width, greaterThanOrEqualTo(48));
            expect(rect.height, greaterThanOrEqualTo(48));
            await tester.tap(target);
            await tester.pumpAndSettle();
            final semantics = tester.ensureSemantics();
            for (var route = 0; route < 5; route++) {
              final node = tester.getSemantics(
                find.byKey(ValueKey('tab-$route')),
              );
              expect(node.hasFlag(SemanticsFlag.isSelected), route == index);
              expect(node.hasFlag(SemanticsFlag.isButton), isTrue);
              expect(node.label, isNotEmpty);
            }
            semantics.dispose();
          }
          expect(visits, [1, 2, 3, 4]);
          expect(find.text('99+'), findsWidgets);
          expect(tester.takeException(), isNull);
          final semantics = tester.ensureSemantics();
          await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
          await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
          await expectLater(tester, meetsGuideline(textContrastGuideline));
          semantics.dispose();
          await tester.pumpWidget(const SizedBox());
        },
      );
    }
  }

  testWidgets('wide dock shows only the selected route label', (tester) async {
    tester.view.physicalSize = const Size(640, 360);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    var selected = 0;
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.lightTheme,
        home: StatefulBuilder(
          builder: (context, setState) => Scaffold(
            bottomNavigationBar: StitchBottomNav(
              currentIndex: selected,
              onTap: (index) => setState(() => selected = index),
            ),
          ),
        ),
      ),
    );
    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Services'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('tab-1')));
    await tester.pumpAndSettle();
    expect(find.text('Services'), findsOneWidget);
    expect(find.text('Home'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
    'header omits appearance toggle and retains profile and cart actions',
    (tester) async {
      final state = AppState(autoLoad: false);
      addTearDown(state.dispose);
      await tester.pumpWidget(
        AnimatedBuilder(
          animation: state,
          builder: (context, _) => MaterialApp(
            theme: AppTheme.lightTheme,
            darkTheme: AppTheme.darkTheme,
            themeMode: state.themeMode,
            themeAnimationDuration: Duration.zero,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(disableAnimations: true),
              child: child!,
            ),
            home: Scaffold(
              appBar: StitchHeader(
                state: state,
                onProfile: () {},
                onCart: () {},
              ),
              bottomNavigationBar: StitchBottomNav(
                currentIndex: 0,
                onTap: (_) {},
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      await state.setThemeMode(ThemeMode.dark);
      await tester.pump();
      expect(find.byIcon(Icons.dark_mode_outlined), findsNothing);
      expect(find.byIcon(Icons.light_mode_outlined), findsNothing);
      expect(find.byTooltip('Switch to dark mode'), findsNothing);
      expect(find.byTooltip('Switch to light mode'), findsNothing);
      expect(find.byTooltip('My profile'), findsOneWidget);
      expect(find.byTooltip('Shopping cart'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await state.setThemeMode(ThemeMode.dark);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('reduced motion updates the active pill immediately', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(640, 360);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    var selected = 0;
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.lightTheme,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(disableAnimations: true),
          child: child!,
        ),
        home: StatefulBuilder(
          builder: (context, setState) => Scaffold(
            bottomNavigationBar: StitchBottomNav(
              currentIndex: selected,
              onTap: (index) => setState(() => selected = index),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.byKey(const ValueKey('tab-1')));
    await tester.pump();
    expect(find.text('Services'), findsOneWidget);
    expect(find.text('Home'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}
