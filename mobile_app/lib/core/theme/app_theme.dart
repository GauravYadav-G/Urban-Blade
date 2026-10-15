import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;

/// One Material 3 color system, shared by both saved appearance modes.
class AppTheme {
  AppTheme._();
  static final ThemeData lightTheme = _build(Brightness.light);
  static final ThemeData darkTheme = _build(Brightness.dark);

  static ThemeData fromColorScheme(ColorScheme scheme) =>
      _build(scheme.brightness, dynamicScheme: scheme);

  static ThemeData _build(Brightness brightness, {ColorScheme? dynamicScheme}) {
    final scheme = dynamicScheme ?? _brandScheme(brightness);
    final base = ThemeData(
        useMaterial3: true,
        colorScheme: scheme,
        brightness: brightness,
        fontFamily: 'PlusJakartaSans',
        materialTapTargetSize: MaterialTapTargetSize.padded,
        visualDensity: VisualDensity.standard);
    final border = OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: scheme.outline));
    final label =
        base.textTheme.labelLarge!.copyWith(fontWeight: FontWeight.w600);
    return base.copyWith(
      scaffoldBackgroundColor: scheme.surface,
      textTheme: base.textTheme.copyWith(
          headlineLarge: base.textTheme.headlineLarge?.copyWith(
              fontSize: 28,
              height: 1.2,
              letterSpacing: -.7,
              fontWeight: FontWeight.w700),
          headlineMedium: base.textTheme.headlineMedium?.copyWith(
              fontSize: 28,
              height: 1.22,
              letterSpacing: -.7,
              fontWeight: FontWeight.w700),
          headlineSmall: base.textTheme.headlineSmall?.copyWith(
              fontSize: 24,
              height: 1.3,
              letterSpacing: -.5,
              fontWeight: FontWeight.w700),
          titleLarge: base.textTheme.titleLarge
              ?.copyWith(fontSize: 20, fontWeight: FontWeight.w600),
          bodyMedium:
              base.textTheme.bodyMedium?.copyWith(fontSize: 14, height: 1.5)),
      appBarTheme: AppBarTheme(
          backgroundColor: scheme.surface.withValues(alpha: .9),
          foregroundColor: scheme.onSurface,
          surfaceTintColor: Colors.transparent,
          centerTitle: true,
          elevation: 0,
          scrolledUnderElevation: 0,
          titleTextStyle: base.textTheme.titleMedium
              ?.copyWith(fontWeight: FontWeight.w700)),
      navigationBarTheme: NavigationBarThemeData(
          height: 80,
          elevation: 0,
          backgroundColor: scheme.surfaceContainer,
          indicatorColor: scheme.secondaryContainer,
          indicatorShape: const StadiumBorder(),
          iconTheme: WidgetStateProperty.resolveWith((states) => IconThemeData(
              size: 24,
              color: states.contains(WidgetState.selected)
                  ? scheme.onSecondaryContainer
                  : scheme.onSurfaceVariant)),
          labelTextStyle: WidgetStateProperty.resolveWith((states) =>
              base.textTheme.labelMedium?.copyWith(
                  fontWeight: states.contains(WidgetState.selected)
                      ? FontWeight.w700
                      : FontWeight.w500,
                  color: states.contains(WidgetState.selected)
                      ? scheme.onSurface
                      : scheme.onSurfaceVariant))),
      cardTheme: CardThemeData(
          color: scheme.surfaceContainerLow,
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          margin: EdgeInsets.zero,
          clipBehavior: Clip.antiAlias,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(20))),
      filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
              minimumSize: const Size(48, 52),
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
              shape: const StadiumBorder(),
              textStyle: label)),
      elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
              minimumSize: const Size(48, 52),
              shape: const StadiumBorder(),
              textStyle: label)),
      outlinedButtonTheme: OutlinedButtonThemeData(
          style: OutlinedButton.styleFrom(
              minimumSize: const Size(48, 48),
              shape: const StadiumBorder(),
              textStyle: label)),
      textButtonTheme: TextButtonThemeData(
          style: TextButton.styleFrom(
              minimumSize: const Size(48, 48), textStyle: label)),
      iconButtonTheme: IconButtonThemeData(
          style: IconButton.styleFrom(
              minimumSize: const Size(48, 48),
              tapTargetSize: MaterialTapTargetSize.padded,
              visualDensity: VisualDensity.standard)),
      inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: scheme.surfaceContainerLow,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 18, vertical: 18),
          hintStyle: TextStyle(color: scheme.onSurfaceVariant),
          border: border,
          enabledBorder: border,
          focusedBorder: border.copyWith(
              borderSide: BorderSide(color: scheme.primary, width: 2)),
          errorBorder:
              border.copyWith(borderSide: BorderSide(color: scheme.error)),
          focusedErrorBorder: border.copyWith(
              borderSide: BorderSide(color: scheme.error, width: 2))),
      chipTheme: base.chipTheme.copyWith(
          backgroundColor: scheme.surfaceContainerLow,
          selectedColor: scheme.secondaryContainer,
          side: BorderSide(color: scheme.outlineVariant),
          shape: const StadiumBorder(),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
          labelStyle:
              base.textTheme.labelLarge?.copyWith(color: scheme.onSurface),
          showCheckmark: true),
      listTileTheme: ListTileThemeData(
          iconColor: scheme.onSurfaceVariant,
          textColor: scheme.onSurface,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
      bottomSheetTheme: BottomSheetThemeData(
          backgroundColor: scheme.surfaceContainerLow,
          modalBackgroundColor: scheme.surfaceContainerLow,
          surfaceTintColor: Colors.transparent,
          showDragHandle: false,
          clipBehavior: Clip.antiAlias,
          shape: RoundedRectangleBorder(
              side: BorderSide(color: scheme.outlineVariant),
              borderRadius:
                  const BorderRadius.vertical(top: Radius.circular(30)))),
      dialogTheme: DialogThemeData(
          backgroundColor: scheme.surfaceContainerHigh,
          surfaceTintColor: Colors.transparent,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(28))),
      snackBarTheme: SnackBarThemeData(
          behavior: SnackBarBehavior.floating,
          backgroundColor: scheme.inverseSurface,
          contentTextStyle: TextStyle(
              color: scheme.onInverseSurface, fontFamily: 'PlusJakartaSans'),
          actionTextColor: scheme.inversePrimary,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
      dividerTheme:
          DividerThemeData(color: scheme.outlineVariant, thickness: 1),
      pageTransitionsTheme: const PageTransitionsTheme(builders: {
        TargetPlatform.android: _CarePageTransitions(),
        TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
        TargetPlatform.macOS: CupertinoPageTransitionsBuilder(),
      }),
    );
  }

  /// Warm editorial surfaces with the same obsidian, amber and slate as the web.
  /// Supported Android wallpaper palettes still use their native semantic colors.
  static ColorScheme _brandScheme(Brightness brightness) {
    final base = ColorScheme.fromSeed(
        seedColor: const Color(0xFFF59E0B), brightness: brightness);
    if (brightness == Brightness.dark) {
      return base.copyWith(
        primary: const Color(0xFFF59E0B),
        onPrimary: const Color(0xFF0B0F19),
        primaryContainer: const Color(0xFF493716),
        onPrimaryContainer: const Color(0xFFFFDFA0),
        secondary: const Color(0xFFFFDFA0),
        onSecondary: const Color(0xFF322507),
        secondaryContainer: const Color(0xFF3E3221),
        onSecondaryContainer: const Color(0xFFFFDFA0),
        surface: const Color(0xFF0B0F19),
        onSurface: const Color(0xFFF8F4EF),
        onSurfaceVariant: const Color(0xFFB4BFCE),
        surfaceContainerLowest: const Color(0xFF080C14),
        surfaceContainerLow: const Color(0xFF131926),
        surfaceContainer: const Color(0xFF1B2230),
        surfaceContainerHigh: const Color(0xFF222B3A),
        surfaceContainerHighest: const Color(0xFF2B3444),
        outline: const Color(0xFF8391A5),
        outlineVariant: const Color(0xFF334155),
      );
    }
    return base.copyWith(
      primary: const Color(0xFF0B0F19),
      onPrimary: Colors.white,
      primaryContainer: const Color(0xFFFFE6B5),
      onPrimaryContainer: const Color(0xFF0B0F19),
      secondary: const Color(0xFF7D570D),
      onSecondary: Colors.white,
      secondaryContainer: const Color(0xFFFFEBC6),
      onSecondaryContainer: const Color(0xFF312511),
      surface: const Color(0xFFFDFBF7),
      onSurface: const Color(0xFF0B0F19),
      onSurfaceVariant: const Color(0xFF536174),
      surfaceContainerLowest: Colors.white,
      surfaceContainerLow: const Color(0xFFF8F4EE),
      surfaceContainer: const Color(0xFFF3EEE6),
      surfaceContainerHigh: const Color(0xFFEDE5D9),
      surfaceContainerHighest: const Color(0xFFE7DFD3),
      outline: const Color(0xFF817568),
      outlineVariant: const Color(0xFFDED7CC),
    );
  }
}

/// Compositor-only route movement: never allocate full-page blur textures.
class _CarePageTransitions extends PageTransitionsBuilder {
  const _CarePageTransitions();
  @override
  Widget buildTransitions<T>(
      PageRoute<T> route,
      BuildContext context,
      Animation<double> animation,
      Animation<double> secondaryAnimation,
      Widget child) {
    if (MediaQuery.disableAnimationsOf(context)) return child;
    final progress = animation.drive(CurveTween(curve: Curves.easeOutQuart));
    final outgoing =
        secondaryAnimation.drive(CurveTween(curve: Curves.easeOutCubic));
    return SlideTransition(
        position: Tween<Offset>(begin: const Offset(0, .045), end: Offset.zero)
            .animate(progress),
        child: AnimatedBuilder(
            animation: outgoing,
            child: RepaintBoundary(child: child),
            builder: (context, child) {
              final value = outgoing.value;
              return Transform.scale(scale: 1 - .018 * value, child: child);
            }));
  }
}
