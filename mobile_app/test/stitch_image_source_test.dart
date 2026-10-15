import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:urban_blade_mobile/core/widgets/stitch_image.dart';

void main() {
  testWidgets('SVG-only bundled artwork renders without an image error',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
            body: StitchImage(
                imageUrl: '/images/placeholder.svg',
                width: 120,
                height: 120))));
    await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 200)));
    await tester.pumpAndSettle();
    expect(find.byType(SvgPicture), findsOneWidget);
    expect(find.text('UB'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('SVG references retain existing curated JPG artwork',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
            body: StitchImage(
                imageUrl: '/images/heroes/hero-2.svg',
                width: 120,
                height: 120))));
    await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 200)));
    await tester.pumpAndSettle();
    expect(find.byType(SvgPicture), findsNothing);
    final image = tester.widget<Image>(find.byType(Image));
    final provider = image.image as ResizeImage;
    expect((provider.imageProvider as AssetImage).assetName,
        'assets/images/heroes/hero-2.jpg');
    expect(tester.takeException(), isNull);
  });

  testWidgets('empty image source uses a normalized local SVG fallback',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
            body: StitchImage(
                imageUrl: '',
                localFallback: 'images/placeholder.svg',
                width: 120,
                height: 120))));
    await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 200)));
    await tester.pumpAndSettle();
    expect(find.byType(SvgPicture), findsOneWidget);
    expect(find.text('UB'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
