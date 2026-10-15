import '../../core/widgets/premium_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/constants/salon_constants.dart';
import '../../core/constants/app_colors.dart';
import '../../core/widgets/glass_panel.dart';
import '../../core/models/booking_model.dart';
import '../../core/services/app_state.dart';
import 'reschedule_sheet.dart';

class AppointmentsScreen extends StatelessWidget {
  final AppState state;
  final VoidCallback onBookNew;

  const AppointmentsScreen({
    super.key,
    required this.state,
    required this.onBookNew,
  });

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: state,
    builder: (context, _) => _buildContent(context),
  );

  Widget _buildContent(BuildContext context) {
    final bookings = state.bookings;

    return PremiumScaffold(
      appBar: AppBar(
        title: const Text('My Appointments'),
        actions: [
          IconButton(
            onPressed: state.loadHistory,
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh appointments',
          ),
        ],
      ),
      body: state.isLoadingHistory
          ? const Center(child: CircularProgressIndicator())
          : state.historyError != null
          ? Center(
              child: SingleChildScrollView(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(state.historyError!, textAlign: TextAlign.center),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: state.loadHistory,
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                ),
              ),
            )
          : bookings.isEmpty
          ? Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(
                      Icons.event_busy,
                      size: 48,
                      color: AppColors.outline,
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'No upcoming appointments',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Book a grooming ritual at our studio or in your home.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 12,
                        color: AppColors.of(context).secondary,
                      ),
                    ),
                    const SizedBox(height: 20),
                    ElevatedButton(
                      onPressed: onBookNew,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Theme.of(context).colorScheme.primary,
                        foregroundColor: Theme.of(
                          context,
                        ).colorScheme.onPrimary,
                      ),
                      child: const Text('Book an Appointment'),
                    ),
                  ],
                ),
              ),
            )
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: bookings.length,
              itemBuilder: (context, index) {
                final b = bookings[index];
                return _buildAppointmentCard(context, b);
              },
            ),
    );
  }

  Widget _buildAppointmentCard(BuildContext context, BookingModel b) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: GlassPanel(
        radius: 22,
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header with ID & Status Pill
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 12,
              runSpacing: 8,
              children: [
                Text(
                  b.id,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                    color: AppColors.of(context).onSurface,
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.secondaryContainer,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    b.statusDisplay.toUpperCase(),
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSecondaryContainer,
                    ),
                  ),
                ),
              ],
            ),
            const Divider(height: 20),

            // Stylist & Service
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CircleAvatar(
                  radius: 24,
                  backgroundImage: b.barber.avatarUrl.startsWith('https://')
                      ? NetworkImage(b.barber.avatarUrl)
                      : null,
                  backgroundColor: Theme.of(context).colorScheme.primary,
                  child: b.barber.avatarUrl.startsWith('https://')
                      ? null
                      : Icon(
                          Icons.person,
                          color: Theme.of(context).colorScheme.onPrimary,
                        ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        b.service.name,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        b.barber.id.isEmpty
                            ? b.barber.name
                            : 'Stylist: ${b.barber.name}${b.barber.title.isEmpty ? '' : ' (${b.barber.title})'}',
                        style: TextStyle(
                          fontSize: 12,
                          color: AppColors.of(context).secondary,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '₹${b.totalAmount}',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: AppColors.of(context).onSurface,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Time & Destination Details
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.of(context).surfaceContainerLow,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Column(
                children: [
                  Row(
                    children: [
                      Icon(
                        Icons.calendar_today,
                        size: 14,
                        color: AppColors.of(context).secondary,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '${b.date} at ${b.timeSlot}',
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(
                        Icons.location_on_outlined,
                        size: 14,
                        color: AppColors.of(context).secondary,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          b.studioOrHomeAddress,
                          style: TextStyle(
                            fontSize: 11,
                            color: AppColors.of(context).secondary,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),

            Wrap(
              spacing: 10,
              runSpacing: 8,
              children: [
                if (b.canReschedule)
                  OutlinedButton.icon(
                    onPressed: () => showRescheduleSheet(context, state, b),
                    icon: const Icon(Icons.edit_calendar_outlined, size: 18),
                    label: const Text('Reschedule appointment'),
                  ),
                OutlinedButton.icon(
                  onPressed: () => _launch(
                    context,
                    Uri.https('www.google.com', '/maps/search/', {
                      'api': '1',
                      'query': b.studioOrHomeAddress,
                    }),
                  ),
                  icon: const Icon(Icons.directions_outlined, size: 18),
                  label: const Text('Directions'),
                ),
                TextButton(
                  onPressed: () => _launch(
                    context,
                    Uri.parse('tel:${SalonConstants.phoneClean}'),
                  ),
                  child: const Text('Contact studio'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _launch(BuildContext context, Uri uri) async {
    try {
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        throw StateError('Unavailable');
      }
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Call ${SalonConstants.phone} for help.'),
          ),
        );
      }
    }
  }
}
