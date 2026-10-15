import 'package:flutter/material.dart';

/// Ultra-Premium Warm Luxury Theming Tokens for Urban Blade
/// Inspired by Dribbble & Pinterest luxury grooming ateliers (Aesop, Tom Ford, Le Labo)
class AppColors {
  AppColors._();
  static AppPalette of(BuildContext context) =>
      AppPalette(Theme.of(context).colorScheme);

  // ─── DEEPEST HERITAGE EMERALDS ───────────────────────────────────────────
  static const Color primary =
      Color(0xFF1D1D1F); // Deepest British Racing Emerald
  static const Color primaryContainer = Color(0xFF1D1D1F); // Deep Atelier Green
  static const Color racingGreen =
      Color(0xFF1D1D1F); // Deep British Racing Green
  static const Color primaryMedium = Color(0xFF6C746E); // Elevated forest
  static const Color primaryLight = Color(0xFF7A827C); // Active emerald chip
  static const Color onPrimary = Color(0xFFFFFFFF);
  static const Color onPrimaryContainer = Color(0xFFA69F93);
  static const Color primaryFixed = Color(0xFFACF0DB);
  static const Color primaryFixedDim = Color(0xFF90D4BF);
  static const Color onPrimaryFixed = Color(0xFF002019);

  // ─── BRUSHED BRASS & CHAMPAGNE GOLD ──────────────────────────────────────
  static const Color goldAccent = Color(0xFFA69F93); // Primary luxury brass
  static const Color champagneGold =
      Color(0xFFA69F93); // Editorial champagne gold
  static const Color champagneGoldDark = Color(0xFF736E64); // Deep gold foil
  static const Color goldLight =
      Color(0xFFD9D5CD); // Champagne shimmer highlight
  static const Color goldDark = Color(0xFF736E64); // Antique bronze shadow
  static const Color goldMuted = Color(0xFFE5E5DF); // Delicate hairline borders
  static const Color goldSurface = Color(0xFFF4F4F0); // Warm gold card tint

  // ─── WARM PARCHMENT & CANVAS SURFACES ───────────────────────────────────
  static const Color canvasBase =
      Color(0xFFF5F5F7); // Warm unbleached parchment
  static const Color parchment = Color(0xFFF5F5F7); // Warm editorial parchment
  static const Color racingGreenDark = Color(0xFF1D1D1F); // Deep racing emerald
  static const Color surface = Color(0xFFF5F5F7);
  static const Color surfaceContainerLowest =
      Color(0xFFFFFFFF); // Pure white card
  static const Color surfaceContainerLow =
      Color(0xFFF1F2EE); // Silk parchment fill
  static const Color surfaceContainer = Color(0xFFE9ECE6);
  static const Color surfaceContainerHigh = Color(0xFFE0E3DC);
  static const Color surfaceContainerHighest = Color(0xFFD5DAD2);
  static const Color surfaceDim = Color(0xFFCDD3CB);
  static const Color surfaceBright = Color(0xFFFFFFFF);
  static const Color surfaceTint = Color(0xFF1D1D1F);

  // ─── SECONDARY & SLATE ACCENTS ──────────────────────────────────────────
  static const Color secondary = Color(0xFF6E6E73);
  static const Color secondaryContainer = Color(0xFFE9ECE6);
  static const Color onSecondary = Color(0xFFFFFFFF);
  static const Color onSecondaryContainer = Color(0xFF283431);
  static const Color onSecondaryFixed = Color(0xFF141F1C);

  // ─── INKS & EDITORIAL TYPOGRAPHY ────────────────────────────────────────
  static const Color onSurface = Color(0xFF1D1D1F); // Crisp bespoke ink
  static const Color onSurfaceVariant =
      Color(0xFF6E6E73); // Muted editorial body
  static const Color onBackground = Color(0xFF1D1D1F);
  static const Color outline = Color(0xFF8A9088);
  static const Color outlineVariant = Color(0xFFE0E3DD);
  static const Color subtleFill = Color(0xFFF1F2EE);
  static const Color softBorder = Color(0xFFE0E3DC);

  // ─── SEMANTIC STATUS ────────────────────────────────────────────────────
  static const Color success = Color(0xFF197349);
  static const Color warning = Color(0xFFB57416);
  static const Color error = Color(0xFFBA1A1A);
  static const Color errorContainer = Color(0xFFFFDAD6);
  static const Color onErrorContainer = Color(0xFF93000A);

  // ─── BESPOKE LUXURY GRADIENTS ───────────────────────────────────────────
  static const LinearGradient goldGradient = LinearGradient(
    colors: [Color(0xFFD9D5CD), Color(0xFFA69F93), Color(0xFF736E64)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient emeraldGradient = LinearGradient(
    colors: [Color(0xFF1D1D1F), Color(0xFF1D1D1F), Color(0xFF6C746E)],
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
  );

  static const LinearGradient racingGreenGradient = emeraldGradient;

  static const LinearGradient vipCardGradient = LinearGradient(
    colors: [Color(0xFF1D1D1F), Color(0xFF1D1D1F), Color(0xFF343D35)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient frostedGlassGradient = LinearGradient(
    colors: [Color(0xCCFFFFFF), Color(0x99FFFFFF)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  // ─── BESPOKE LUXURY SHADOWS ─────────────────────────────────────────────
  static List<BoxShadow> get luxuryCardShadow => [
        BoxShadow(
          color: const Color(0xFF1D1D1F).withValues(alpha: 0.04),
          blurRadius: 16,
          offset: const Offset(0, 6),
        ),
        BoxShadow(
          color: const Color(0xFFA69F93).withValues(alpha: 0.06),
          blurRadius: 8,
          offset: const Offset(0, 2),
        ),
      ];

  static List<BoxShadow> get goldGlowShadow => [
        BoxShadow(
          color: const Color(0xFFA69F93).withValues(alpha: 0.35),
          blurRadius: 18,
          offset: const Offset(0, 6),
        ),
      ];

  static List<BoxShadow> get emeraldFloatingShadow => [
        BoxShadow(
          color: const Color(0xFF1D1D1F).withValues(alpha: 0.30),
          blurRadius: 20,
          offset: const Offset(0, 8),
        ),
      ];
}

/// Semantic colors resolve from the surrounding Theme, including dialogs.
class AppPalette {
  final ColorScheme scheme;
  const AppPalette(this.scheme);
  bool get dark => scheme.brightness == Brightness.dark;
  Color get secondary => scheme.onSurfaceVariant;
  Color get onSurface => scheme.onSurface;
  Color get surface => scheme.surface;
  Color get surfaceContainerLow => scheme.surfaceContainerLow;
  Color get secondaryContainer => scheme.secondaryContainer;
  Color get softBorder => scheme.outlineVariant;
  Color get outlineVariant => scheme.outlineVariant;
  Color get error => scheme.error;
}
