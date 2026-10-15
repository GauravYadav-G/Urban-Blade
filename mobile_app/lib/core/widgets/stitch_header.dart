import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/app_state.dart';
import 'glass_panel.dart';

/// An editorial masthead: left-aligned identity, independent glass actions.
class StitchHeader extends StatelessWidget implements PreferredSizeWidget {
  final AppState state;
  final String? title;
  final bool showBack;
  final bool dark;
  final VoidCallback? onBack, onProfile, onCart;
  const StitchHeader({
    super.key,
    required this.state,
    this.title,
    this.showBack = false,
    this.dark = false,
    this.onBack,
    this.onProfile,
    this.onCart,
  });

  @override
  Size get preferredSize => const Size.fromHeight(84);

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final compact = MediaQuery.textScalerOf(context).scale(14) > 21;
    final isDark = scheme.brightness == Brightness.dark;
    final actionStyle = IconButton.styleFrom(
      foregroundColor: scheme.onSurface,
      minimumSize: const Size(48, 48),
      padding: const EdgeInsets.all(12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
    );
    Widget action({required Widget child, Color? tint}) => SizedBox(
      width: 50,
      height: 50,
      child: GlassPanel(radius: 18, liquid: true, tint: tint, child: child),
    );
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: isDark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark,
      child: Material(
        key: const ValueKey('editorial-header'),
        color: Colors.transparent,
        child: SafeArea(
          bottom: false,
          child: SizedBox(
            height: 84,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              child: Row(
                children: [
                  if (showBack) ...[
                    action(
                      child: BackButton(onPressed: onBack, style: actionStyle),
                    ),
                    const SizedBox(width: 12),
                  ],
                  Expanded(
                    child: Semantics(
                      header: true,
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (!compact) ...[
                            Row(
                              children: [
                                Container(
                                  width: 14,
                                  height: 2,
                                  color: scheme.secondary,
                                ),
                                const SizedBox(width: 7),
                                Flexible(
                                  child: Text(
                                    title == null ? 'URBAN' : 'URBAN BLADE',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontSize: 9,
                                      letterSpacing: 2.6,
                                      fontWeight: FontWeight.w600,
                                      color: scheme.onSurfaceVariant,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 5),
                          ],
                          Text(
                            title ?? (compact ? 'Urban Blade' : 'BLADE'),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: compact ? 16 : 25,
                              height: 1.05,
                              letterSpacing: -.9,
                              fontWeight: FontWeight.w800,
                              color: scheme.onSurface,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  if (!showBack) ...[
                    action(
                      child: IconButton(
                        tooltip: 'My profile',
                        style: actionStyle,
                        onPressed: onProfile,
                        icon: const Icon(
                          Icons.person_outline_rounded,
                          size: 22,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                  ],
                  action(
                    tint: scheme.primaryContainer,
                    child: IconButton(
                      tooltip: 'Shopping cart',
                      style: actionStyle,
                      onPressed: onCart,
                      icon: Badge(
                        isLabelVisible: state.cartCount > 0,
                        backgroundColor: scheme.primary,
                        textColor: scheme.onPrimary,
                        label: Text(
                          state.cartCount > 99 ? '99+' : '${state.cartCount}',
                        ),
                        child: const Icon(
                          Icons.shopping_bag_outlined,
                          size: 22,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
