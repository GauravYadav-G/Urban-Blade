import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../models/product_model.dart';
import 'stitch_image.dart';
import 'premium_scaffold.dart';
import 'entrance.dart';
import 'glass_panel.dart';

class ProductCard extends StatelessWidget {
  final ProductModel product;
  final bool saved;
  final bool? dark;
  final int motionOrder;
  final String? heroTag;
  final VoidCallback onOpen, onSave;
  final VoidCallback? onAdd;
  final ValueChanged<Offset>? onAddFrom;
  const ProductCard(
      {super.key,
      required this.product,
      required this.saved,
      this.dark,
      this.motionOrder = 0,
      required this.onOpen,
      required this.onSave,
      this.onAdd,
      this.onAddFrom,
      this.heroTag});

  @override
  Widget build(BuildContext context) => Entrance(
      order: motionOrder,
      horizontal: true,
      child: RepaintBoundary(child:
          PressScale(child: LayoutBuilder(builder: (context, constraints) {
        final scheme = Theme.of(context).colorScheme;
        final canAdd = onAdd != null || onAddFrom != null;
        final metrics = _ProductCardMetrics.measure(
            context, product, constraints.maxWidth,
            canAdd: canAdd);
        final photoHeight = constraints.maxWidth / .92;
        final image = StitchImage(
            imageUrl: product.imageUrl,
            width: constraints.maxWidth,
            height: photoHeight);
        return Semantics(
            button: true,
            label: 'View ${product.name}',
            child: Material(
                color: Colors.transparent,
                clipBehavior: Clip.antiAlias,
                borderRadius: BorderRadius.circular(28),
                child: InkWell(
                    onTap: onOpen,
                    child: SizedBox(
                        height: photoHeight + metrics.height - 24,
                        child: Stack(children: [
                          Positioned(
                              top: 0,
                              left: 0,
                              right: 0,
                              height: photoHeight,
                              child: ClipRRect(
                                  borderRadius: BorderRadius.circular(28),
                                  child: heroTag == null
                                      ? image
                                      : Hero(tag: heroTag!, child: image))),
                          Positioned(
                              top: 6,
                              right: 6,
                              child: IconButton(
                                  tooltip: saved
                                      ? 'Unsave ${product.name}'
                                      : 'Save ${product.name}',
                                  style: IconButton.styleFrom(
                                      backgroundColor: scheme.surfaceContainerLowest
                                          .withValues(alpha: .94),
                                      foregroundColor: scheme.onSurface,
                                      side: BorderSide(
                                          color: scheme.outlineVariant
                                              .withValues(alpha: .45))),
                                  onPressed: onSave,
                                  icon: AnimatedSwitcher(
                                      duration: MediaQuery.disableAnimationsOf(context)
                                          ? Duration.zero
                                          : const Duration(milliseconds: 180),
                                      transitionBuilder: (child, animation) =>
                                          ScaleTransition(
                                              scale: animation, child: child),
                                      child: Icon(
                                          saved ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                                          key: ValueKey(saved),
                                          size: 19)))),
                          if ((product.badge?.isNotEmpty ?? false) ||
                              !product.inStock)
                            Positioned(
                                top: 16,
                                left: 12,
                                right: 64,
                                child: Align(
                                    alignment: Alignment.centerLeft,
                                    child: GlassPanel(
                                        radius: 12,
                                        overImage: true,
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 9, vertical: 6),
                                        child: Text(
                                            !product.inStock
                                                ? 'Sold out'
                                                : product.badge!,
                                            style: metrics.categoryStyle)))),
                          Positioned(
                              bottom: 0,
                              left: 6,
                              right: 6,
                              child: GlassPanel(
                                  radius: 22,
                                  overImage: true,
                                  padding: const EdgeInsets.all(12),
                                  child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        SizedBox(
                                            height: metrics.nameHeight,
                                            child: Text(product.name,
                                                maxLines: 2,
                                                overflow: TextOverflow.ellipsis,
                                                style: metrics.nameStyle)),
                                        if (metrics.category.isNotEmpty) ...[
                                          const SizedBox(height: 4),
                                          Text(metrics.category,
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                              style: metrics.categoryStyle),
                                        ],
                                        if (product.reviewCount > 0) ...[
                                          const SizedBox(height: 6),
                                          Text(
                                              '★ ${product.rating.toStringAsFixed(1)}  (${product.reviewCount})',
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                              style: metrics.reviewStyle),
                                        ],
                                        const SizedBox(height: 8),
                                        Row(children: [
                                          Expanded(
                                              child: Column(
                                                  crossAxisAlignment:
                                                      CrossAxisAlignment.start,
                                                  mainAxisSize:
                                                      MainAxisSize.min,
                                                  children: [
                                                Text('₹${product.price}',
                                                    style: metrics.priceStyle),
                                                if (metrics.hasComparison) ...[
                                                  const SizedBox(height: 2),
                                                  Text(
                                                      '₹${product.compareAtPrice}',
                                                      style: metrics
                                                          .comparisonStyle),
                                                ],
                                              ])),
                                          if (canAdd) ...[
                                            const SizedBox(width: 8),
                                            Builder(
                                                builder: (buttonContext) =>
                                                    IconButton(
                                                        tooltip:
                                                            'Add ${product.name} to bag',
                                                        onPressed:
                                                            onAddFrom == null
                                                                ? onAdd
                                                                : () {
                                                                    final box =
                                                                        buttonContext.findRenderObject()
                                                                            as RenderBox;
                                                                    onAddFrom!(box.localToGlobal(box
                                                                        .size
                                                                        .center(
                                                                            Offset.zero)));
                                                                  },
                                                        icon: const Icon(
                                                            Icons.add,
                                                            size: 18),
                                                        style: IconButton.styleFrom(
                                                            foregroundColor:
                                                                scheme
                                                                    .onPrimary,
                                                            backgroundColor:
                                                                scheme.primary,
                                                            minimumSize:
                                                                const Size(
                                                                    48, 48),
                                                            visualDensity:
                                                                VisualDensity
                                                                    .standard))),
                                          ],
                                        ]),
                                      ]))),
                        ])))));
      }))));
}

/// Reserve the caption's measured height so large text never covers the photo.
class _ProductCardMetrics {
  final double height;
  final double nameHeight;
  final String category;
  final bool hasComparison;
  final TextStyle nameStyle,
      categoryStyle,
      reviewStyle,
      priceStyle,
      comparisonStyle;
  const _ProductCardMetrics(
      {required this.height,
      required this.nameHeight,
      required this.category,
      required this.hasComparison,
      required this.nameStyle,
      required this.categoryStyle,
      required this.reviewStyle,
      required this.priceStyle,
      required this.comparisonStyle});

  factory _ProductCardMetrics.measure(
      BuildContext context, ProductModel product, double width,
      {required bool canAdd}) {
    final scheme = Theme.of(context).colorScheme;
    final base = Theme.of(context).textTheme.bodyMedium ??
        DefaultTextStyle.of(context).style;
    final nameStyle = base.copyWith(
        fontSize: 13,
        height: 1.35,
        fontWeight: FontWeight.w600,
        color: scheme.onSurface);
    final categoryStyle = base.copyWith(
        fontSize: 10, height: 1.4, color: scheme.onSurfaceVariant);
    final reviewStyle = categoryStyle.copyWith(color: scheme.onSurfaceVariant);
    final priceStyle = base.copyWith(
        fontSize: 15,
        height: 1.2,
        fontWeight: FontWeight.w700,
        color: scheme.onSurface);
    final comparisonStyle = base.copyWith(
        fontSize: 10,
        height: 1.3,
        color: scheme.onSurfaceVariant,
        decoration: TextDecoration.lineThrough);
    final contentWidth =
        math.max(1.0, width - 12 - 24 - GlassPanel.borderWidthOf(context) * 2);
    double measure(String value, TextStyle style, double available,
        {int? lines}) {
      final painter = TextPainter(
          text: TextSpan(text: value, style: style),
          textDirection: Directionality.of(context),
          textScaler: MediaQuery.textScalerOf(context),
          maxLines: lines,
          ellipsis: lines == null ? null : '…')
        ..layout(maxWidth: math.max(1.0, available));
      final height = painter.height.ceilToDouble();
      painter.dispose();
      return height;
    }

    final category = [product.category, product.volume]
        .where((value) => value.isNotEmpty)
        .join(' · ');
    final hasComparison = product.compareAtPrice != null &&
        product.compareAtPrice! > product.price;
    final moneyWidth = contentWidth - (canAdd ? 56 : 0);
    final moneyHeight = measure('₹${product.price}', priceStyle, moneyWidth) +
        (hasComparison
            ? 2 +
                measure(
                    '₹${product.compareAtPrice}', comparisonStyle, moneyWidth)
            : 0);
    final nameHeight = measure('M\nM', nameStyle, contentWidth, lines: 2);
    final height = 24 +
        GlassPanel.borderWidthOf(context) * 2 +
        nameHeight +
        (category.isEmpty
            ? 0
            : 4 + measure(category, categoryStyle, contentWidth, lines: 1)) +
        (product.reviewCount > 0
            ? 6 +
                measure(
                    '★ ${product.rating.toStringAsFixed(1)}  (${product.reviewCount})',
                    reviewStyle,
                    contentWidth,
                    lines: 1)
            : 0) +
        8 +
        math.max(canAdd ? 48 : 0, moneyHeight);
    return _ProductCardMetrics(
        height: height,
        nameHeight: nameHeight,
        category: category,
        hasComparison: hasComparison,
        nameStyle: nameStyle,
        categoryStyle: categoryStyle,
        reviewStyle: reviewStyle,
        priceStyle: priceStyle,
        comparisonStyle: comparisonStyle);
  }
}
