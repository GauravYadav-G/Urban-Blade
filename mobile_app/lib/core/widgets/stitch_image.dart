import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../constants/salon_constants.dart';
import '../constants/app_colors.dart';

class StitchImage extends StatelessWidget {
  final String imageUrl;
  final double? width;
  final double? height;
  final BoxFit fit;
  final BorderRadius? borderRadius;
  final String? localFallback;

  const StitchImage({
    super.key,
    required this.imageUrl,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.borderRadius,
    this.localFallback,
  });

  @override
  Widget build(BuildContext context) {
    if (width != null) {
      return _buildImage(context, width!);
    }
    return LayoutBuilder(
        builder: (context, constraints) => _buildImage(
            context,
            constraints.hasBoundedWidth
                ? constraints.maxWidth
                : MediaQuery.sizeOf(context).width));
  }

  Widget _buildImage(BuildContext context, double logicalWidth) {
    Widget imageWidget;
    final decodeWidth = (logicalWidth * MediaQuery.devicePixelRatioOf(context))
        .ceil()
        .clamp(64, 1600);

    final resolvedPath = _assetPath(imageUrl.trim());
    final uri = Uri.tryParse(resolvedPath);
    final isSvg = uri?.path.toLowerCase().endsWith('.svg') ?? false;

    if (resolvedPath.startsWith('http://') ||
        resolvedPath.startsWith('https://')) {
      if (isSvg) {
        imageWidget = SvgPicture.network(
          resolvedPath,
          width: width,
          height: height,
          fit: fit,
          placeholderBuilder: (_) => _fallbackContainer(),
          errorBuilder: (_, __, ___) => _localFallback(decodeWidth),
        );
      } else {
        imageWidget = CachedNetworkImage(
          memCacheWidth: decodeWidth,
          fadeInDuration: Duration.zero,
          imageUrl: resolvedPath,
          width: width,
          height: height,
          fit: fit,
          placeholder: (context, url) => Container(
            width: width,
            height: height,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  AppColors.primary.withValues(alpha: 0.15),
                  AppColors.of(context).surfaceContainerLow,
                ],
              ),
            ),
            child: const Center(
              child: SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(
                  strokeWidth: 1.8,
                  color: AppColors.champagneGold,
                ),
              ),
            ),
          ),
          errorWidget: (_, __, ___) => _localFallback(decodeWidth),
        );
      }
    } else if (resolvedPath.startsWith('assets/')) {
      // Keep the curated JPG artwork where supplied. SVG-only assets fall
      // back to their real source instead of requesting a nonexistent JPG.
      final bitmapPath = isSvg
          ? resolvedPath.replaceFirst(
              RegExp(r'\.svg$', caseSensitive: false), '.jpg')
          : resolvedPath;
      imageWidget = Image.asset(
        bitmapPath,
        cacheWidth: decodeWidth,
        width: width,
        height: height,
        fit: fit,
        errorBuilder: (_, __, ___) {
          if (isSvg) {
            return SvgPicture.asset(
              resolvedPath,
              width: width,
              height: height,
              fit: fit,
              errorBuilder: (_, __, ___) => _localFallback(decodeWidth),
            );
          }
          final remoteUrl =
              '${SalonConstants.apiBaseUrl}/${resolvedPath.replaceFirst("assets/", "")}';
          return CachedNetworkImage(
            memCacheWidth: decodeWidth,
            fadeInDuration: Duration.zero,
            imageUrl: remoteUrl,
            width: width,
            height: height,
            fit: fit,
            errorWidget: (_, __, ___) => _localFallback(decodeWidth),
          );
        },
      );
    } else {
      imageWidget = _localFallback(decodeWidth);
    }

    if (borderRadius != null) {
      return ClipRRect(
        borderRadius: borderRadius!,
        child: imageWidget,
      );
    }

    return imageWidget;
  }

  static String _assetPath(String path) {
    if (path.startsWith('/images/')) return 'assets$path';
    if (path.startsWith('images/')) return 'assets/$path';
    return path;
  }

  Widget _localFallback(int decodeWidth) {
    final path = _assetPath(localFallback?.trim() ?? '');
    if (!path.startsWith('assets/')) return _fallbackContainer();
    if (path.toLowerCase().endsWith('.svg')) {
      return SvgPicture.asset(
        path,
        width: width,
        height: height,
        fit: fit,
        errorBuilder: (_, __, ___) => _fallbackContainer(),
      );
    }
    return Image.asset(
      path,
      cacheWidth: decodeWidth,
      width: width,
      height: height,
      fit: fit,
      errorBuilder: (_, __, ___) => _fallbackContainer(),
    );
  }

  Widget _fallbackContainer() {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.racingGreenDark,
            AppColors.primaryContainer,
          ],
        ),
        border: Border.all(
          color: AppColors.champagneGold.withValues(alpha: 0.2),
          width: 0.8,
        ),
      ),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: AppColors.champagneGold.withValues(alpha: 0.6),
                  width: 1,
                ),
              ),
              child: const Center(
                child: Text(
                  'UB',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1,
                    color: AppColors.champagneGold,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
