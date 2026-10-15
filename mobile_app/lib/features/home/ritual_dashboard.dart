import 'package:flutter/material.dart';
import '../../core/widgets/glass_panel.dart';
import '../../core/widgets/premium_scaffold.dart';

/// Theme-aware dashboard with bounded refractive glass surfaces.
class RitualDashboard extends StatelessWidget {
  final String greeting;
  final VoidCallback onServices, onStudio, onHome, onBook;
  const RitualDashboard({
    super.key,
    required this.greeting,
    required this.onServices,
    required this.onStudio,
    required this.onHome,
    required this.onBook,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final largeText = MediaQuery.textScalerOf(context).scale(14) > 21;
    final booking = _BookingTile(onTap: onServices);
    final stacked = largeText || MediaQuery.sizeOf(context).width < 350;
    Widget place(Widget child) => stacked ? child : Expanded(child: child);
    final places = Column(
      children: [
        place(
          _PlaceTile(
            key: const ValueKey('home-card-studio'),
            title: 'At the studio',
            subtitle: 'Our space, your time.',
            icon: Icons.chair_outlined,
            onTap: onStudio,
          ),
        ),
        const SizedBox(height: 12),
        place(
          _PlaceTile(
            key: const ValueKey('home-card-home'),
            title: 'At your place',
            subtitle: 'Same care, where you are.',
            icon: Icons.home_outlined,
            onTap: onHome,
          ),
        ),
      ],
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          greeting,
          style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13),
        ),
        const SizedBox(height: 6),
        const Text(
          'What’s your ritual today?',
          style: TextStyle(
            fontSize: 25,
            height: 1.2,
            letterSpacing: -.8,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 18),
        if (stacked) ...[
          booking,
          const SizedBox(height: 12),
          places,
        ] else
          // Only three fixed dashboard tiles are measured; catalog lists remain
          // lazy. Equal columns keep the card edges aligned at each text scale.
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: booking),
                const SizedBox(width: 12),
                Expanded(child: places),
              ],
            ),
          ),
        const SizedBox(height: 12),
        GlassPanel(
          liquid: true,
          radius: 20,
          child: InkWell(
            key: const ValueKey('home-next-visit'),
            onTap: onBook,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  const Icon(Icons.calendar_month_outlined, size: 26),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Your next visit',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          'Find your time',
                          style: TextStyle(
                            color: scheme.onSurfaceVariant,
                            fontSize: 11,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right, size: 20),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _BookingTile extends StatelessWidget {
  final VoidCallback onTap;
  const _BookingTile({required this.onTap});
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return RepaintBoundary(
      child: PressScale(
        child: GlassPanel(
          key: const ValueKey('home-card-services'),
          liquid: true,
          radius: 22,
          tint: scheme.primaryContainer,
          child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: DefaultTextStyle.merge(
                style: TextStyle(color: scheme.onSurface),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Align(
                      alignment: Alignment.centerRight,
                      child: Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Icon(
                          Icons.content_cut_rounded,
                          size: 58,
                          color: scheme.primary,
                        ),
                      ),
                    ),
                    const Text(
                      'Book a\nfresh start.',
                      style: TextStyle(
                        fontSize: 27,
                        height: 1.08,
                        letterSpacing: -.8,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Haircuts, beard & more',
                      style: TextStyle(
                        fontSize: 11,
                        height: 1.3,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 14),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 13,
                      ),
                      decoration: BoxDecoration(
                        color: scheme.primary,
                        borderRadius: BorderRadius.circular(24),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Choose a service',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                                color: scheme.onPrimary,
                              ),
                            ),
                          ),
                          const SizedBox(width: 6),
                          Icon(
                            Icons.arrow_forward,
                            size: 15,
                            color: scheme.onPrimary,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _PlaceTile extends StatelessWidget {
  final String title, subtitle;
  final IconData icon;
  final VoidCallback onTap;
  const _PlaceTile({
    super.key,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) => PressScale(
    child: GlassPanel(
      liquid: true,
      radius: 20,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 23),
          child: Row(
            children: [
              Icon(icon, size: 28),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      subtitle,
                      style: TextStyle(
                        fontSize: 10,
                        height: 1.4,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, size: 16),
            ],
          ),
        ),
      ),
    ),
  );
}
