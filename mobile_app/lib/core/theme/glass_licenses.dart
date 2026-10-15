import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

void registerGlassLicenses() {
  LicenseRegistry.addLicense(() async* {
    for (final entry in {
      'vue-web-liquid-glass': 'LICENSE.vue-web-liquid-glass',
      'LiquidGlass-Cpp / AndroidLiquidGlass': 'LICENSE.Apache-2.0',
      'LiquidGlass-Cpp attribution': 'NOTICE.LiquidGlass-Cpp',
    }.entries) {
      try {
        final text = await rootBundle.loadString(
          'third_party/liquid_glass/${entry.value}',
        );
        yield LicenseEntryWithLineBreaks([entry.key], text);
      } catch (error) {
        throw StateError(
          'Could not load the bundled ${entry.key} license: $error',
        );
      }
    }
  });
}
