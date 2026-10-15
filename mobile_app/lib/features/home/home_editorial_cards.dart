import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/app_state.dart';
import '../../core/widgets/premium_scaffold.dart';
import '../../core/widgets/stitch_image.dart';
import '../../core/widgets/glass_panel.dart';

/// Image-led navigation with a single, accessible tap target per card.
class RitualCategories extends StatelessWidget {
  final AppState state;
  final ValueChanged<String> onSelected;
  const RitualCategories(
      {super.key, required this.state, required this.onSelected});

  @override
  Widget build(BuildContext context) {
    final categories = state.products.map((p) => p.category).toSet().toList();
    return SizedBox(
      height: 170 + (MediaQuery.textScalerOf(context).scale(14) - 14) * 2,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: categories.length,
        separatorBuilder: (_, __) => const SizedBox(width: 12),
        itemBuilder: (context, index) {
          final category = categories[index];
          final products = state.products.where((p) => p.category == category);
          final label = category.isEmpty
              ? 'Care'
              : '${category[0].toUpperCase()}${category.substring(1)}';
          return SizedBox(
              width: 148,
              child: PressScale(
                  child: GlassPanel(
                radius: 20,
                child: InkWell(
                    key: ValueKey('home-category-$category'),
                    onTap: () => onSelected(category),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Expanded(
                            child: StitchImage(
                                imageUrl: products.first.imageUrl, width: 148)),
                        Padding(
                            padding: const EdgeInsets.fromLTRB(12, 10, 10, 10),
                            child: Row(children: [
                              Expanded(
                                  child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                    Text(label,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                            fontSize: 13,
                                            fontWeight: FontWeight.w600)),
                                    const SizedBox(height: 3),
                                    Text(
                                        '${products.length} ${products.length == 1 ? 'essential' : 'essentials'}',
                                        style: TextStyle(
                                            fontSize: 11,
                                            color: AppColors.of(context)
                                                .secondary)),
                                  ])),
                              const Icon(Icons.north_east, size: 14),
                            ])),
                      ],
                    )),
              )));
        },
      ),
    );
  }
}
