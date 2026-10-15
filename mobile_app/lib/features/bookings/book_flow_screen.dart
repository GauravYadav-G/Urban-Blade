import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/app_state.dart';
import '../../core/models/booking_model.dart';
import '../../core/widgets/delivery_editor.dart';
import '../../core/widgets/glass_panel.dart';
import '../../core/widgets/commerce_ui.dart';
import '../../core/widgets/premium_scaffold.dart';
import '../auth/login_screen.dart';

class BookFlowScreen extends StatefulWidget {
  final AppState state;
  final VoidCallback onBookingComplete;
  const BookFlowScreen(
      {super.key, required this.state, required this.onBookingComplete});
  @override
  State<BookFlowScreen> createState() => _BookFlowScreenState();
}

class _BookFlowScreenState extends State<BookFlowScreen> {
  int _step = 0, _request = 0;
  bool _loading = false, _submitting = false;
  String? _error;
  List<String> _slots = [];
  BookingModel? _booking;
  late final _dates =
      List.generate(14, (i) => DateTime.now().add(Duration(days: i + 1)));
  Object? _draftSnapshot;
  Object get _currentDraft => (
        widget.state.services,
        Object.hashAllUnordered(widget.state.selectedServiceIds),
        widget.state.locationMode,
        widget.state.selectedDate,
        widget.state.selectedTimeSlot,
        widget.state.homeAddress,
        widget.state.isLoggedIn
      );

  void _draftChanged() {
    final next = _currentDraft;
    if (_draftSnapshot != next) setState(() => _draftSnapshot = next);
  }

  @override
  void initState() {
    super.initState();
    _draftSnapshot = _currentDraft;
    widget.state.addListener(_draftChanged);
  }

  @override
  void didUpdateWidget(covariant BookFlowScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.state != widget.state) {
      oldWidget.state.removeListener(_draftChanged);
      widget.state.addListener(_draftChanged);
      _draftSnapshot = _currentDraft;
    }
  }

  @override
  void dispose() {
    _request++;
    widget.state.removeListener(_draftChanged);
    super.dispose();
  }

  Future<void> _availability() async {
    if (!mounted) return;
    final request = ++_request;
    final state = widget.state;
    state.setSelectedTimeSlot('');
    setState(() {
      _loading = true;
      _slots = [];
      _error = null;
    });
    try {
      final slots = await state.api.fetchAvailableSlots(
          state.isStudioMode ? 'salon' : 'home', state.selectedDate);
      if (mounted && request == _request) setState(() => _slots = slots);
    } catch (e) {
      if (mounted && request == _request) setState(() => _error = e.toString());
    } finally {
      if (mounted && request == _request) setState(() => _loading = false);
    }
  }

  Future<void> _next() async {
    if (!mounted || _loading || _submitting) return;
    final state = widget.state;
    if (_step == 0) {
      if (state.selectedServices.isEmpty) {
        setState(() => _error = 'Choose a service to continue.');
        return;
      }
      if (!state.isStudioMode && state.homeAddress.isEmpty) {
        final saved = await editDeliveryAddress(context, state);
        if (!mounted || !saved) return;
      }
      setState(() {
        _step = 1;
        _error = null;
      });
      await _availability();
    } else if (_step == 1) {
      if (!_slots.contains(state.selectedTimeSlot)) {
        setState(() => _error = 'Choose an available time to continue.');
        return;
      }
      setState(() {
        _step = 2;
        _error = null;
      });
    } else {
      setState(() {
        _submitting = true;
        _error = null;
      });
      try {
        if (!state.isLoggedIn) {
          await Navigator.push(
              context,
              MaterialPageRoute(
                  builder: (ctx) => LoginScreen(
                      state: state, onLoginSuccess: () => Navigator.pop(ctx))));
          if (!mounted || !state.isLoggedIn) return;
        }
        if (state.userPhone.isEmpty && state.deliveryPhone.isEmpty) {
          final saved = await editDeliveryAddress(context, state);
          if (!mounted || !saved) return;
        }
        final booking = await state.createBooking();
        if (mounted) setState(() => _booking = booking);
      } catch (e) {
        if (!mounted) return;
        await _availability();
        if (mounted) {
          setState(() {
            _error = e.toString();
            _step = 1;
          });
        }
      } finally {
        if (mounted) setState(() => _submitting = false);
      }
    }
  }

  Widget _serviceStep(AppState state) =>
      CustomScrollView(key: const ValueKey(0), slivers: [
        const SliverPadding(
            padding: EdgeInsets.fromLTRB(20, 20, 20, 0),
            sliver: SliverToBoxAdapter(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                  CommerceIntro(
                      title: 'What can we do for you?',
                      eyebrow: 'Your appointment',
                      icon: Icons.spa_outlined),
                  SizedBox(height: 22),
                ]))),
        SliverPadding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            sliver: SliverList.builder(
                itemCount: state.services.length,
                itemBuilder: (context, index) {
                  final service = state.services[index];
                  return Padding(
                      key: ValueKey('booking-service-${service.id}'),
                      padding: const EdgeInsets.only(bottom: 8),
                      child: GlassPanel(
                          child: RadioListTile<String>(
                              value: service.id,
                              groupValue: state.selectedServiceIds.firstOrNull,
                              onChanged: (_) {
                                if (!state.selectedServiceIds
                                    .contains(service.id)) {
                                  state.toggleServiceSelection(service.id);
                                }
                              },
                              title: Text(service.name,
                                  style: const TextStyle(
                                      fontSize: 14,
                                      fontWeight: FontWeight.w600)),
                              subtitle: Text(
                                  '${service.duration} · ₹${service.price}',
                                  style: const TextStyle(fontSize: 12)))));
                })),
        SliverPadding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
            sliver: SliverToBoxAdapter(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                  if (state.services.isEmpty)
                    const Text(
                        'Services are unavailable. Refresh the catalog to try again.'),
                  const SizedBox(height: 18),
                  const Text('Care from our team',
                      style: TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 10),
                  const Text(
                      'The salon will assign the right specialist for your service.'),
                  const SizedBox(height: 18),
                  const Text('Where would you like your service?',
                      style: TextStyle(fontWeight: FontWeight.w700)),
                  RadioListTile(
                      value: 'studio',
                      groupValue: state.locationMode,
                      onChanged: (v) => state.setLocationMode(v!),
                      title: const Text('At the studio'),
                      subtitle: Text(state.currentStudio)),
                  RadioListTile(
                      value: 'home',
                      groupValue: state.locationMode,
                      onChanged: (v) => state.setLocationMode(v!),
                      title: const Text('At home'),
                      subtitle:
                          const Text('Professional care in your own space')),
                  if (!state.isStudioMode)
                    TextButton.icon(
                        onPressed: () => editDeliveryAddress(context, state),
                        icon: const Icon(Icons.location_on_outlined),
                        label: Text(state.homeAddress.isEmpty
                            ? 'Add home address'
                            : 'Edit home address')),
                  if (_error != null)
                    Padding(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        child: Text(_error!,
                            style:
                                TextStyle(color: AppColors.of(context).error))),
                ]))),
      ]);

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    if (_booking != null) {
      return Center(
          child: SingleChildScrollView(
              padding: const EdgeInsets.all(28),
              child: Column(children: [
                const SuccessSeal(),
                const SizedBox(height: 24),
                Text('See you soon.',
                    style: Theme.of(context).textTheme.headlineLarge),
                const SizedBox(height: 12),
                Text(
                    'Your appointment is confirmed for ${_booking!.date} at ${_booking!.timeSlot}.',
                    textAlign: TextAlign.center),
                const SizedBox(height: 20),
                SelectableText('Booking ${_booking!.id}',
                    textAlign: TextAlign.center),
                const SizedBox(height: 24),
                FilledButton(
                    onPressed: () {
                      setState(() {
                        _booking = null;
                        _step = 0;
                      });
                      widget.onBookingComplete();
                    },
                    child: const Text('Back to home')),
              ])));
    }
    return Column(children: [
      Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
          child: Row(
              children: List.generate(
                  3,
                  (i) => Expanded(
                      child: Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                LinearProgressIndicator(
                                    value: i <= _step ? 1 : 0,
                                    minHeight: 4,
                                    borderRadius: BorderRadius.circular(4)),
                                const SizedBox(height: 8),
                                Text(
                                    [
                                      '01 Services',
                                      '02 Schedule',
                                      '03 Review'
                                    ][i],
                                    style: TextStyle(
                                        fontSize: 10,
                                        fontWeight: i == _step
                                            ? FontWeight.w700
                                            : FontWeight.w400,
                                        color: AppColors.of(context).secondary))
                              ])))))),
      Expanded(
          child: CommerceFlowTransition(
              child: KeyedSubtree(
                  key: ValueKey(_step),
                  child: _step == 0
                      ? _serviceStep(state)
                      : ListView(
                          key: ValueKey(_step),
                          padding: const EdgeInsets.all(20),
                          children: [
                              CommerceIntro(
                                  title: [
                                    'What can we do for you?',
                                    'Find your moment.',
                                    'Everything look right?'
                                  ][_step],
                                  eyebrow: 'Your appointment',
                                  icon: [
                                    Icons.spa_outlined,
                                    Icons.calendar_month_outlined,
                                    Icons.check_circle_outline
                                  ][_step]),
                              const SizedBox(height: 22),
                              if (_step == 1) ...[
                                SizedBox(
                                    height: 84 +
                                        (MediaQuery.textScalerOf(context)
                                                        .scale(11) -
                                                    11)
                                                .clamp(0, double.infinity) *
                                            1.5 +
                                        (MediaQuery.textScalerOf(context)
                                                        .scale(23) -
                                                    23)
                                                .clamp(0, double.infinity) *
                                            1.5,
                                    child: ListView.separated(
                                        scrollDirection: Axis.horizontal,
                                        itemCount: _dates.length,
                                        separatorBuilder: (_, __) =>
                                            const SizedBox(width: 10),
                                        itemBuilder: (_, i) {
                                          final date = DateFormat('yyyy-MM-dd')
                                              .format(_dates[i]);
                                          final selected =
                                              date == state.selectedDate;
                                          return InkWell(
                                              onTap: () {
                                                state.setSelectedDate(date);
                                                _availability();
                                              },
                                              borderRadius:
                                                  BorderRadius.circular(18),
                                              child: Container(
                                                  width: 68 +
                                                      (MediaQuery.textScalerOf(context).scale(11) - 11).clamp(
                                                              0,
                                                              double.infinity) *
                                                          3,
                                                  decoration: BoxDecoration(
                                                      color: selected
                                                          ? Theme.of(context)
                                                              .colorScheme
                                                              .primary
                                                          : AppColors.of(context)
                                                              .surfaceContainerLow,
                                                      borderRadius:
                                                          BorderRadius.circular(
                                                              18),
                                                      border: Border.all(
                                                          color: AppColors.of(
                                                                  context)
                                                              .outlineVariant)),
                                                  child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                                                    Text(
                                                        DateFormat('EEE')
                                                            .format(_dates[i]),
                                                        style: TextStyle(
                                                            fontSize: 11,
                                                            color: selected
                                                                ? Theme.of(
                                                                        context)
                                                                    .colorScheme
                                                                    .onPrimary
                                                                    .withValues(
                                                                        alpha:
                                                                            .75)
                                                                : AppColors.of(
                                                                        context)
                                                                    .secondary)),
                                                    const SizedBox(height: 8),
                                                    Text(
                                                        DateFormat('d')
                                                            .format(_dates[i]),
                                                        style: TextStyle(
                                                            fontSize: 23,
                                                            fontWeight:
                                                                FontWeight.w700,
                                                            color: selected
                                                                ? Theme.of(
                                                                        context)
                                                                    .colorScheme
                                                                    .onPrimary
                                                                : AppColors.of(
                                                                        context)
                                                                    .onSurface))
                                                  ])));
                                        })),
                                const SizedBox(height: 26),
                                const Text('Available times',
                                    style:
                                        TextStyle(fontWeight: FontWeight.w700)),
                                const SizedBox(height: 14),
                                if (_loading)
                                  const Center(
                                      child: CircularProgressIndicator())
                                else
                                  Wrap(
                                      spacing: 10,
                                      runSpacing: 10,
                                      children: _slots
                                          .map((slot) => ChoiceChip(
                                              label: Text(slot),
                                              labelStyle: TextStyle(
                                                  color:
                                                      state.selectedTimeSlot ==
                                                              slot
                                                          ? Theme.of(context)
                                                              .colorScheme
                                                              .onPrimary
                                                          : AppColors.of(
                                                                  context)
                                                              .secondary),
                                              selected:
                                                  state.selectedTimeSlot ==
                                                      slot,
                                              onSelected: (_) => state
                                                  .setSelectedTimeSlot(slot)))
                                          .toList()),
                                if (!_loading && _slots.isEmpty)
                                  const Text(
                                      'No available times. Try another date or retry availability.'),
                                TextButton.icon(
                                    onPressed: _loading ? null : _availability,
                                    icon: const Icon(Icons.refresh),
                                    label: const Text('Refresh availability')),
                              ],
                              if (_step == 2)
                                GlassPanel(
                                    child: Padding(
                                        padding: const EdgeInsets.all(22),
                                        child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              ...state.selectedServices.map(
                                                  (s) => Padding(
                                                      padding:
                                                          const EdgeInsets.only(
                                                              bottom: 12),
                                                      child: Row(children: [
                                                        Expanded(
                                                            child:
                                                                Text(s.name)),
                                                        const SizedBox(
                                                            width: 12),
                                                        Flexible(
                                                            child: Text(
                                                                '₹${s.price}',
                                                                textAlign:
                                                                    TextAlign
                                                                        .end))
                                                      ]))),
                                              const Divider(),
                                              const Text(
                                                  'Specialist assigned by the salon',
                                                  style: TextStyle(
                                                      fontWeight:
                                                          FontWeight.w700)),
                                              const SizedBox(height: 8),
                                              Text(
                                                  '${state.selectedDate} · ${state.selectedTimeSlot}'),
                                              const SizedBox(height: 8),
                                              Text(state.isStudioMode
                                                  ? state.currentStudio
                                                  : state.homeAddress),
                                              const Divider(height: 32),
                                              Text(
                                                  'Total ₹${state.selectedServicesPrice}',
                                                  style: Theme.of(context)
                                                      .textTheme
                                                      .titleLarge),
                                              const SizedBox(height: 8),
                                              Text(
                                                  'Pay for your service at your appointment.',
                                                  style: TextStyle(
                                                      fontSize: 12,
                                                      color:
                                                          AppColors.of(context)
                                                              .secondary)),
                                            ]))),
                              if (_error != null)
                                Padding(
                                    padding: const EdgeInsets.symmetric(
                                        vertical: 16),
                                    child: Text(_error!,
                                        style: TextStyle(
                                            color:
                                                AppColors.of(context).error))),
                            ])))),
      SafeArea(
          top: false,
          child: Padding(
              padding: const EdgeInsets.all(16),
              child: CommerceActionArea(
                  child: Row(children: [
                if (_step > 0) ...[
                  IconButton(
                      tooltip: 'Previous step',
                      onPressed: _submitting
                          ? null
                          : () => setState(() {
                                _step--;
                                _error = null;
                              }),
                      icon: const Icon(Icons.arrow_back)),
                  const SizedBox(width: 12)
                ],
                Expanded(
                    child: FilledButton(
                        onPressed: _loading || _submitting ? null : _next,
                        child: Text(_submitting
                            ? 'Confirming…'
                            : [
                                'Choose date & time',
                                'Review appointment',
                                state.isLoggedIn
                                    ? 'Confirm appointment'
                                    : 'Sign in & confirm'
                              ][_step])))
              ])))),
    ]);
  }
}
