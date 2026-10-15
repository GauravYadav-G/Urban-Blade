import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/models/booking_model.dart';
import '../../core/services/app_state.dart';
import '../../core/widgets/commerce_ui.dart';
import '../../core/widgets/glass_panel.dart';

Future<void> showRescheduleSheet(
  BuildContext context,
  AppState state,
  BookingModel booking,
) async {
  await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => GlassPanel(
      radius: 28,
      child: _RescheduleForm(state: state, booking: booking),
    ),
  );
}

class _RescheduleForm extends StatefulWidget {
  final AppState state;
  final BookingModel booking;
  const _RescheduleForm({required this.state, required this.booking});
  @override
  State<_RescheduleForm> createState() => _RescheduleFormState();
}

class _RescheduleFormState extends State<_RescheduleForm> {
  late final Object _session = widget.state.accountSessionKey;
  late String _date = widget.booking.date;
  String? _slot, _error;
  List<String> _slots = const [];
  bool _loading = false, _busy = false;
  int _request = 0;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _loadSlots();
    });
  }

  Future<void> _loadSlots() async {
    final request = ++_request;
    setState(() {
      _loading = true;
      _slot = null;
      _slots = const [];
      _error = null;
    });
    try {
      final slots = await widget.state.fetchRescheduleSlots(
        widget.booking,
        _date,
      );
      if (mounted &&
          request == _request &&
          _session == widget.state.accountSessionKey) {
        setState(() => _slots = slots);
      }
    } catch (error) {
      if (mounted && request == _request) {
        setState(() => _error = error.toString());
      }
    } finally {
      if (mounted && request == _request) setState(() => _loading = false);
    }
  }

  Future<void> _pickDate() async {
    final india = DateTime.now().toUtc().add(
      const Duration(hours: 5, minutes: 30),
    );
    final today = DateTime(india.year, india.month, india.day);
    final initial = DateTime.tryParse(_date) ?? today;
    final selected = await showDatePicker(
      context: context,
      initialDate: initial.isBefore(today) ? today : initial,
      firstDate: today,
      lastDate: initial.isAfter(DateTime(today.year + 2, 12, 31))
          ? initial
          : DateTime(today.year + 2, 12, 31),
    );
    if (selected == null ||
        !mounted ||
        _session != widget.state.accountSessionKey) {
      return;
    }
    setState(() => _date = DateFormat('yyyy-MM-dd').format(selected));
    await _loadSlots();
  }

  Future<void> _submit() async {
    if (_busy || _loading || _slot == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.state.rescheduleBooking(widget.booking, _date, _slot!);
      if (mounted && _session == widget.state.accountSessionKey) {
        Navigator.pop(context, true);
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.state,
    builder: (context, _) {
      if (_session != widget.state.accountSessionKey) {
        return const Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Your account changed. Close this form and sign in again.',
          ),
        );
      }
      final changed =
          _date != widget.booking.date || _slot != widget.booking.timeSlot;
      return PopScope(
        canPop: !_busy,
        child: SafeArea(
          top: false,
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                CommerceSheetHeader(
                  title: 'Reschedule appointment',
                  icon: Icons.edit_calendar_outlined,
                  onClose: _busy ? () {} : () => Navigator.pop(context),
                ),
                const SizedBox(height: 12),
                Text(
                  widget.booking.service.name,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 6),
                Text(
                  'Currently ${widget.booking.date} at ${widget.booking.timeSlot}',
                ),
                const SizedBox(height: 8),
                const Text(
                  'Choose a new time. Your service, price, visit address and salon assignment stay with this appointment.',
                ),
                const SizedBox(height: 18),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _pickDate,
                  icon: const Icon(Icons.calendar_today_outlined),
                  label: Text('Choose date · $_date'),
                ),
                const SizedBox(height: 16),
                if (_loading)
                  const LinearProgressIndicator()
                else if (_slots.isEmpty && _error == null)
                  const Text(
                    'No available times on this day. Choose another date.',
                  ),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: _slots
                      .map(
                        (slot) => ChoiceChip(
                          label: Text(slot),
                          selected: _slot == slot,
                          onSelected: _busy
                              ? null
                              : (_) => setState(() => _slot = slot),
                        ),
                      )
                      .toList(),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 14),
                  Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                  TextButton(
                    onPressed: _busy || _loading ? null : _loadSlots,
                    child: const Text('Retry availability'),
                  ),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy || _loading || _slot == null || !changed
                      ? null
                      : _submit,
                  child: Text(
                    _busy ? 'Confirming…' : 'Confirm new appointment time',
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
}
