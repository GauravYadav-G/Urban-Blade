import 'package:flutter/material.dart';
import 'glass_panel.dart';
import '../constants/app_colors.dart';
import '../models/order_model.dart';

String paymentLabel(String status) => switch (status.toLowerCase()) {
  'captured' || 'paid' => 'Paid',
  'pending' => 'Pending',
  'failed' => 'Failed',
  'refunded' => 'Refunded',
  'partially_refunded' => 'Partially refunded',
  'authorized' => 'Awaiting capture',
  _ => status.isEmpty ? 'Not available' : status.replaceAll('_', ' '),
};

bool isOrderActive(OrderModel order) =>
    order.status != OrderStatus.delivered &&
    order.status != OrderStatus.cancelled;

class StatusPill extends StatelessWidget {
  final String label;
  final bool warning, error;
  const StatusPill(
    this.label, {
    super.key,
    this.warning = false,
    this.error = false,
  });
  @override
  Widget build(BuildContext context) {
    final color = error
        ? AppColors.of(context).error
        : warning
        ? (Theme.of(context).brightness == Brightness.dark
              ? const Color(0xFFFFCC4D)
              : const Color(0xFF805415))
        : AppColors.of(context).onSurface;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .09),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }
}

class CommercePanel extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  const CommercePanel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(18),
  });
  @override
  Widget build(BuildContext context) => GlassPanel(
    radius: 24,
    child: Padding(padding: padding, child: child),
  );
}

class CommerceIntro extends StatelessWidget {
  final String title, eyebrow;
  final String? description;
  final IconData icon;
  const CommerceIntro({
    super.key,
    required this.title,
    required this.eyebrow,
    required this.icon,
    this.description,
  });
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Row(
        children: [
          GlassPanel(
            radius: 14,
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Icon(
                icon,
                size: 19,
                color: Theme.of(context).colorScheme.primary,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              eyebrow.toUpperCase(),
              style: TextStyle(
                fontSize: 10,
                letterSpacing: 1.6,
                fontWeight: FontWeight.w700,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
      ),
      const SizedBox(height: 16),
      Text(title, style: Theme.of(context).textTheme.headlineMedium),
      if (description != null) ...[
        const SizedBox(height: 8),
        Text(
          description!,
          style: TextStyle(
            height: 1.5,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    ],
  );
}

/// Only the bounded action surface samples the backdrop, keeping scrolling
/// product and form content free of repeated blur layers.
class CommerceActionArea extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  const CommerceActionArea({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(14),
  });
  @override
  Widget build(BuildContext context) => GlassPanel(
    radius: 26,
    blur: true,
    child: Padding(padding: padding, child: child),
  );
}

class CommerceSheetHeader extends StatelessWidget {
  final String title;
  final String? subtitle;
  final IconData icon;
  final VoidCallback? onClose;
  final String closeTooltip;
  final bool compact;
  const CommerceSheetHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.icon = Icons.person_outline,
    this.onClose,
    this.closeTooltip = 'Close',
    this.compact = false,
  });
  @override
  Widget build(BuildContext context) => GlassPanel(
    radius: 22,
    blur: true,
    child: Padding(
      padding: EdgeInsets.all(compact ? 6 : 12),
      child: Row(
        children: [
          if (!compact) ...[
            Padding(
              padding: const EdgeInsets.all(8),
              child: Icon(
                icon,
                size: 22,
                color: Theme.of(context).colorScheme.primary,
              ),
            ),
            const SizedBox(width: 4),
          ],
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(left: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (!compact && subtitle != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      subtitle!,
                      style: TextStyle(
                        fontSize: 11,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          if (onClose != null)
            IconButton(
              tooltip: closeTooltip,
              onPressed: onClose,
              icon: const Icon(Icons.close_rounded, size: 20),
            ),
        ],
      ),
    ),
  );
}

class CommerceFlowTransition extends StatelessWidget {
  final Widget child;
  const CommerceFlowTransition({super.key, required this.child});
  @override
  Widget build(BuildContext context) => AnimatedSwitcher(
    duration: MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 240),
    switchInCurve: Curves.easeOutCubic,
    switchOutCurve: Curves.easeInCubic,
    transitionBuilder: (child, animation) => FadeTransition(
      opacity: animation,
      child: SlideTransition(
        position: animation.drive(
          Tween(begin: const Offset(0, .025), end: Offset.zero),
        ),
        child: child,
      ),
    ),
    child: child,
  );
}

class MoneyLine extends StatelessWidget {
  final String label;
  final num amount;
  final bool total;
  const MoneyLine(this.label, this.amount, {super.key, this.total = false});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 7),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              color: AppColors.of(context).secondary,
              fontSize: total ? 16 : 13,
            ),
          ),
        ),
        const SizedBox(width: 12),
        Flexible(
          child: Text(
            '${amount < 0 ? '−' : ''}₹${amount.abs()}',
            style: TextStyle(
              fontSize: total ? 22 : 14,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    ),
  );
}
