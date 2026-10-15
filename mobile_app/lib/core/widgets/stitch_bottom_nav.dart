import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'glass_panel.dart';

/// The selected route expands into a pill; every route retains a 48px target.
class StitchBottomNav extends StatelessWidget {
  final int currentIndex, cartItemCount;
  final bool dark;
  final ValueChanged<int> onTap;
  const StitchBottomNav({
    super.key,
    required this.currentIndex,
    required this.onTap,
    this.cartItemCount = 0,
    this.dark = false,
  });

  static const _labels = ['Home', 'Services', 'Book', 'Shop', 'Profile'];
  static const _icons = [
    Icons.home_outlined,
    Icons.content_cut_outlined,
    Icons.calendar_today_outlined,
    Icons.shopping_bag_outlined,
    Icons.person_outline,
  ];
  static const _selectedIcons = [
    Icons.home_rounded,
    Icons.content_cut_rounded,
    Icons.calendar_today_rounded,
    Icons.shopping_bag_rounded,
    Icons.person_rounded,
  ];

  void _select(int index) {
    if (index == currentIndex) return;
    HapticFeedback.selectionClick();
    onTap(index);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = scheme.brightness == Brightness.dark;
    final selectedFill = isDark ? scheme.primary : scheme.primaryContainer;
    final selectedForeground = isDark
        ? scheme.onPrimary
        : scheme.onPrimaryContainer;
    final duration = MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 300);
    final labelStyle = DefaultTextStyle.of(context).style.merge(
      TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w700,
        color: selectedForeground,
      ),
    );
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
        child: Align(
          heightFactor: 1,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: GlassPanel(
              liquid: true,
              radius: 30,
              blur: true,
              tint: scheme.surfaceContainerLowest,
              child: SizedBox(
                key: const ValueKey('glass-nav-surface'),
                height: 72,
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 10,
                  ),
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      final text = TextPainter(
                        text: TextSpan(
                          text: _labels[currentIndex],
                          style: labelStyle,
                        ),
                        textDirection: Directionality.of(context),
                        textScaler: MediaQuery.textScalerOf(context),
                        maxLines: 1,
                      )..layout();
                      final labelWidth = text.width;
                      text.dispose();
                      final activeWidth =
                          labelWidth + 54 <= constraints.maxWidth - 192
                          ? labelWidth + 54
                          : 48.0;
                      return Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: List.generate(5, (index) {
                          final active = index == currentIndex;
                          return TweenAnimationBuilder<double>(
                            tween: Tween(
                              begin: active ? 1 : 0,
                              end: active ? 1 : 0,
                            ),
                            duration: duration,
                            curve: Curves.easeOutCubic,
                            builder: (context, emphasis, _) {
                              final width = 48 + (activeWidth - 48) * emphasis;
                              final showLabel =
                                  active && width >= labelWidth + 54;
                              final fill = Color.lerp(
                                Colors.transparent,
                                selectedFill,
                                emphasis,
                              )!;
                              final foreground = Color.lerp(
                                scheme.onSurfaceVariant,
                                selectedForeground,
                                emphasis,
                              )!;
                              final icon = Badge(
                                isLabelVisible: index == 3 && cartItemCount > 0,
                                backgroundColor: scheme.secondaryContainer,
                                textColor: scheme.onSecondaryContainer,
                                label: Text(
                                  cartItemCount > 99 ? '99+' : '$cartItemCount',
                                ),
                                child: Icon(
                                  active
                                      ? _selectedIcons[index]
                                      : _icons[index],
                                  size: 22,
                                  color: foreground,
                                ),
                              );
                              return SizedBox(
                                width: width,
                                height: 48,
                                child: Semantics(
                                  key: ValueKey('tab-$index'),
                                  container: true,
                                  button: true,
                                  enabled: true,
                                  selected: active,
                                  label: index == 3 && cartItemCount > 0
                                      ? 'Shop, $cartItemCount items in cart'
                                      : _labels[index],
                                  onTap: () => _select(index),
                                  child: ExcludeSemantics(
                                    child: Tooltip(
                                      message: _labels[index],
                                      excludeFromSemantics: true,
                                      child: Material(
                                        color: fill,
                                        borderRadius: BorderRadius.circular(24),
                                        clipBehavior: Clip.antiAlias,
                                        child: InkWell(
                                          onTap: () => _select(index),
                                          borderRadius: BorderRadius.circular(
                                            24,
                                          ),
                                          child: Center(
                                            child: Row(
                                              mainAxisSize: MainAxisSize.min,
                                              children: [
                                                icon,
                                                if (showLabel) ...[
                                                  const SizedBox(width: 8),
                                                  Text(
                                                    _labels[index],
                                                    style: labelStyle,
                                                    maxLines: 1,
                                                  ),
                                                ],
                                              ],
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              );
                            },
                          );
                        }),
                      );
                    },
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
