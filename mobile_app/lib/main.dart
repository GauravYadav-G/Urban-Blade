import 'dart:async';
import 'package:dynamic_color/dynamic_color.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'core/constants/salon_constants.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/glass_licenses.dart';
import 'core/performance/frame_metrics.dart';
import 'core/services/app_state.dart';
import 'core/routes/app_routes.dart';
import 'features/main_shell.dart';
import 'features/auth/login_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  FrameMetrics.start();
  registerGlassLicenses();

  // Set system navigation and status bar overlay style
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
      systemNavigationBarColor: Color(0xFFF5F5F7),
      systemNavigationBarIconBrightness: Brightness.dark,
    ),
  );

  final appState = AppState();

  runApp(UrbanBladeMobileApp(appState: appState));
}

class UrbanBladeMobileApp extends StatefulWidget {
  final AppState appState;

  const UrbanBladeMobileApp({super.key, required this.appState});

  @override
  State<UrbanBladeMobileApp> createState() => _UrbanBladeMobileAppState();
}

class _UrbanBladeMobileAppState extends State<UrbanBladeMobileApp>
    with WidgetsBindingObserver {
  ThemeData _lightTheme = AppTheme.lightTheme;
  ThemeData _darkTheme = AppTheme.darkTheme;
  ColorScheme? _systemLight, _systemDark;
  int _paletteRequest = 0;

  // Wallpaper selection happens outside this app. Re-read on resume instead of
  // reading the palette once at startup or resetting the Navigator with a key.
  Future<void> _refreshSystemPalette() async {
    final request = ++_paletteRequest;
    try {
      final palette = await DynamicColorPlugin.getCorePalette();
      if (!mounted || request != _paletteRequest) return;
      final light = palette?.toColorScheme();
      final dark = palette?.toColorScheme(brightness: Brightness.dark);
      if (light == _systemLight && dark == _systemDark) return;
      setState(() {
        _systemLight = light;
        _systemDark = dark;
        _lightTheme = light == null
            ? AppTheme.lightTheme
            : AppTheme.fromColorScheme(light);
        _darkTheme = dark == null
            ? AppTheme.darkTheme
            : AppTheme.fromColorScheme(dark);
      });
    } on PlatformException {
      // Keep the last valid palette if the platform is temporarily unavailable.
    } on MissingPluginException {
      // Older Android versions and unsupported platforms retain the brand theme.
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_refreshSystemPalette());
  }

  @override
  void didChangePlatformBrightness() => unawaited(_refreshSystemPalette());

  late ThemeMode _mode;
  AppState get appState => widget.appState;

  @override
  void initState() {
    super.initState();
    _mode = appState.themeMode;
    appState.addListener(_appearanceChanged);
    WidgetsBinding.instance.addObserver(this);
    unawaited(_refreshSystemPalette());
  }

  void _appearanceChanged() {
    if (_mode != appState.themeMode) {
      setState(() => _mode = appState.themeMode);
    }
  }

  @override
  void didUpdateWidget(covariant UrbanBladeMobileApp oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.appState != appState) {
      oldWidget.appState.removeListener(_appearanceChanged);
      appState.addListener(_appearanceChanged);
      _mode = appState.themeMode;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    appState.removeListener(_appearanceChanged);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: SalonConstants.appName,
      debugShowCheckedModeBanner: false,
      theme: _lightTheme,
      darkTheme: _darkTheme,
      themeMode: _mode,
      themeAnimationDuration:
          WidgetsBinding
              .instance
              .platformDispatcher
              .accessibilityFeatures
              .disableAnimations
          ? Duration.zero
          : const Duration(milliseconds: 240),
      builder: (context, child) {
        final dark = Theme.of(context).brightness == Brightness.dark;
        return AnnotatedRegion<SystemUiOverlayStyle>(
          value: SystemUiOverlayStyle(
            statusBarColor: Colors.transparent,
            statusBarIconBrightness: dark ? Brightness.light : Brightness.dark,
            statusBarBrightness: dark ? Brightness.dark : Brightness.light,
            systemNavigationBarColor: Theme.of(context).scaffoldBackgroundColor,
            systemNavigationBarIconBrightness: dark
                ? Brightness.light
                : Brightness.dark,
          ),
          child: child!,
        );
      },
      initialRoute: AppRoutes.root,
      routes: {
        AppRoutes.root: (context) => MainShell(state: appState),
        AppRoutes.home: (context) => MainShell(state: appState),
        AppRoutes.profile: (context) =>
            MainShell(state: appState, initialTab: 4),
        AppRoutes.login: (context) => LoginScreen(
          state: appState,
          onLoginSuccess: () => Navigator.pop(context),
        ),
      },
    );
  }
}
