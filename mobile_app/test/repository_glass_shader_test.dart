import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'repository shader refracts edges, preserves center and clips corners',
    () async {
      final program = await ui.FragmentProgram.fromAsset(
        'shaders/repository_liquid_glass.frag',
      );
      final sourceRecorder = ui.PictureRecorder();
      final sourceCanvas = Canvas(sourceRecorder);
      for (var x = 0; x < 64; x++) {
        sourceCanvas.drawRect(
          Rect.fromLTWH(x.toDouble(), 0, 1, 64),
          Paint()..color = Color.fromARGB(255, x * 4, 80, 255 - x * 4),
        );
      }
      final sourcePicture = sourceRecorder.endRecording();
      final source = await sourcePicture.toImage(64, 64);
      addTearDown(source.dispose);
      addTearDown(sourcePicture.dispose);
      final shader = program.fragmentShader();
      addTearDown(shader.dispose);
      shader
        ..setFloat(0, 64)
        ..setFloat(1, 64)
        ..setFloat(2, 12)
        ..setFloat(3, 8)
        ..setFloat(4, 10)
        ..setFloat(5, 1.5)
        ..setFloat(6, .035)
        ..setFloat(7, 0)
        ..setFloat(8, 0)
        ..setFloat(9, 0)
        ..setFloat(10, 0)
        ..setImageSampler(0, source);
      final recorder = ui.PictureRecorder();
      Canvas(
        recorder,
      ).drawRect(const Rect.fromLTWH(0, 0, 64, 64), Paint()..shader = shader);
      final picture = recorder.endRecording();
      final output = await picture.toImage(64, 64);
      addTearDown(picture.dispose);
      addTearDown(output.dispose);
      final actual = (await output.toByteData(
        format: ui.ImageByteFormat.rawRgba,
      ))!;
      final original = (await source.toByteData(
        format: ui.ImageByteFormat.rawRgba,
      ))!;
      int channel(ByteData data, int x, int y, int channel) =>
          data.getUint8((y * 64 + x) * 4 + channel);
      expect(
        channel(actual, 32, 32, 0),
        closeTo(channel(original, 32, 32, 0), 2),
      );
      expect(
        channel(actual, 4, 32, 0),
        greaterThan(channel(original, 4, 32, 0) + 2),
      );
      expect(
        channel(actual, 59, 32, 0),
        lessThan(channel(original, 59, 32, 0) - 2),
      );
      expect(channel(actual, 0, 0, 3), 0);
      expect(channel(actual, 32, 32, 3), 255);
    },
  );
}
