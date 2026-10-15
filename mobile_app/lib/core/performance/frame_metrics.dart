import 'dart:convert';
import 'dart:developer' as developer;
import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';

/// Opt-in, profile-only measurements; never runs in the shipped release.
class FrameMetrics {
  static void start() {
    if (!kProfileMode || !const bool.fromEnvironment('FRAME_METRICS')) return;
    final build = <int>[];
    final raster = <int>[];
    var warmup = 60;
    SchedulerBinding.instance.addTimingsCallback((List<FrameTiming> timings) {
      for (final frame in timings) {
        if (warmup > 0) {
          warmup--;
          continue;
        }
        build.add(frame.buildDuration.inMicroseconds);
        raster.add(frame.rasterDuration.inMicroseconds);
        if (build.length < 240) continue;
        double percentile(List<int> samples, double p) {
          final sorted = [...samples]..sort();
          return sorted[((sorted.length - 1) * p).ceil()] / 1000;
        }

        final reportedHz =
            PlatformDispatcher.instance.implicitView?.display.refreshRate ?? 60;
        final targetHz =
            reportedHz.isFinite && reportedHz > 0 ? reportedHz : 60.0;
        final budgetMicros = 1000000 / targetHz;
        developer.log(
            jsonEncode({
              'frames': build.length,
              'targetHz': targetHz,
              'budgetMs': budgetMicros / 1000,
              'buildP90Ms': percentile(build, .9),
              'buildP99Ms': percentile(build, .99),
              'rasterP90Ms': percentile(raster, .9),
              'rasterP99Ms': percentile(raster, .99),
              'overBudgetFrames': List.generate(
                      build.length,
                      (i) =>
                          build[i] > budgetMicros || raster[i] > budgetMicros)
                  .where((v) => v)
                  .length,
            }),
            name: 'urbanblade.frames');
        build.clear();
        raster.clear();
      }
    });
  }
}
