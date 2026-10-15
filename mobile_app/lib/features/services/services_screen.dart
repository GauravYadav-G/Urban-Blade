import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import '../../core/services/app_state.dart';
import '../../core/models/service_model.dart';
import '../../core/widgets/stitch_image.dart';
import '../../core/widgets/glass_panel.dart';
import '../../core/widgets/premium_scaffold.dart';
import '../../core/widgets/entrance.dart';

/// Treatments have their own selection and booking flow, separate from the bag.
class ServicesScreen extends StatefulWidget {
  final AppState state;
  final VoidCallback onProceedToBooking;
  const ServicesScreen(
      {super.key, required this.state, required this.onProceedToBooking});
  @override
  State<ServicesScreen> createState() => _ServicesScreenState();
}

class _ServicesScreenState extends State<ServicesScreen> {
  String _query = '', _category = 'all';
  List<ServiceModel> _visible = [];
  List<ServiceModel>? _source;
  Set<String> _selection = {};
  List<String> _categories = [];

  @override
  void initState() {
    super.initState();
    widget.state.addListener(_refresh);
    _filter();
  }

  @override
  void didUpdateWidget(covariant ServicesScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.state != widget.state) {
      oldWidget.state.removeListener(_refresh);
      widget.state.addListener(_refresh);
      _filter();
    }
  }

  @override
  void dispose() {
    widget.state.removeListener(_refresh);
    super.dispose();
  }

  void _refresh() {
    if (!identical(_source, widget.state.services)) {
      setState(_filter);
    } else if (!setEquals(_selection, widget.state.selectedServiceIds)) {
      setState(() => _selection = Set.of(widget.state.selectedServiceIds));
    }
  }

  void _filter() {
    _source = widget.state.services;
    _selection = Set.of(widget.state.selectedServiceIds);
    _categories = [
      'all',
      ...widget.state.services
          .map((s) => s.category)
          .where((c) => c.isNotEmpty)
          .toSet()
    ];
    if (!_categories.contains(_category)) _category = 'all';
    final query = _query.trim().toLowerCase();
    _visible = widget.state.services
        .where((s) =>
            (_category == 'all' || s.category == _category) &&
            (query.isEmpty ||
                '${s.name} ${s.description}'.toLowerCase().contains(query)))
        .toList();
  }

  String _label(String category) => category == 'all'
      ? 'All treatments'
      : '${category[0].toUpperCase()}${category.substring(1)}';

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    final colors = Theme.of(context).colorScheme;
    return Column(children: [
      Expanded(
          child: RefreshIndicator(
              onRefresh: state.loadRemoteData,
              child: CustomScrollView(
                  key: const PageStorageKey('services-scroll'),
                  physics: const AlwaysScrollableScrollPhysics(),
                  slivers: [
                    SliverPadding(
                        padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
                        sliver: SliverToBoxAdapter(
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                              Text('THE GROOMING STUDIO',
                                  style: TextStyle(
                                      fontSize: 11,
                                      letterSpacing: 2,
                                      fontWeight: FontWeight.w700,
                                      color: colors.onSurfaceVariant)),
                              const SizedBox(height: 12),
                              Text('Time for yourself.',
                                  style: Theme.of(context)
                                      .textTheme
                                      .headlineLarge),
                              const SizedBox(height: 10),
                              Text(
                                  'Choose your treatments. We’ll take care of the details.',
                                  style: TextStyle(
                                      color: colors.onSurfaceVariant)),
                              const SizedBox(height: 22),
                              GlassPanel(
                                  radius: 18,
                                  child: TextField(
                                      onChanged: (value) => setState(() {
                                            _query = value;
                                            _filter();
                                          }),
                                      decoration: const InputDecoration(
                                          hintText: 'Search services',
                                          prefixIcon: Icon(Icons.search)))),
                              const SizedBox(height: 16),
                              GlassPanel(
                                  radius: 24,
                                  child: Padding(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 8, vertical: 4),
                                      child: SingleChildScrollView(
                                          scrollDirection: Axis.horizontal,
                                          child: Row(children: [
                                            for (final category in _categories)
                                              Padding(
                                                  padding:
                                                      const EdgeInsets.only(
                                                          right: 8),
                                                  child: ChoiceChip(
                                                      label: Text(
                                                          _label(category)),
                                                      selected:
                                                          _category == category,
                                                      onSelected: (_) =>
                                                          setState(() {
                                                            _category =
                                                                category;
                                                            _filter();
                                                          })))
                                          ])))),
                              const SizedBox(height: 24),
                              Text(
                                  _category == 'all'
                                      ? 'Our service menu'
                                      : _label(_category),
                                  style:
                                      Theme.of(context).textTheme.titleLarge),
                              const SizedBox(height: 6),
                              Text('Choose a service to book an appointment.',
                                  style: TextStyle(
                                      fontSize: 12,
                                      color: colors.onSurfaceVariant)),
                            ]))),
                    if (_visible.isEmpty)
                      const SliverFillRemaining(
                          hasScrollBody: false,
                          child: Center(
                              child: Padding(
                                  padding: EdgeInsets.all(24),
                                  child: Text(
                                      'No matching services. Try another category or search.',
                                      textAlign: TextAlign.center)))),
                    SliverPadding(
                        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
                        sliver: SliverList.separated(
                            itemCount: _visible.length,
                            separatorBuilder: (_, __) =>
                                const SizedBox(height: 12),
                            itemBuilder: (_, index) => Entrance(
                                order: index % 3,
                                child: _serviceCard(_visible[index])))),
                  ]))),
      if (state.selectedServices.isNotEmpty)
        SafeArea(
            top: false,
            child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                child: GlassPanel(
                    radius: 24,
                    blur: true,
                    child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                  '${state.selectedServices.length} selected · ₹${state.selectedServicesPrice}',
                                  textAlign: TextAlign.center,
                                  style:
                                      Theme.of(context).textTheme.labelLarge),
                              const SizedBox(height: 8),
                              FilledButton.icon(
                                  onPressed: widget.onProceedToBooking,
                                  icon: const Icon(Icons.arrow_forward_rounded),
                                  label: Text(
                                      'Book ${state.selectedServices.length} ${state.selectedServices.length == 1 ? 'service' : 'services'} · ₹${state.selectedServicesPrice}')),
                            ]))))),
    ]);
  }

  Widget _serviceCard(ServiceModel service) {
    final selected = widget.state.selectedServiceIds.contains(service.id);
    final colors = Theme.of(context).colorScheme;
    return RepaintBoundary(
        child: Semantics(
            selected: selected,
            button: true,
            child: PressScale(
                child: GlassPanel(
                    radius: 24,
                    child: InkWell(
                        onTap: () =>
                            widget.state.toggleServiceSelection(service.id),
                        child: AnimatedContainer(
                            duration: MediaQuery.disableAnimationsOf(context)
                                ? Duration.zero
                                : const Duration(milliseconds: 220),
                            curve: Curves.easeOutCubic,
                            decoration: BoxDecoration(
                                color: selected
                                    ? colors.secondaryContainer
                                        .withValues(alpha: .35)
                                    : Colors.transparent,
                                borderRadius: BorderRadius.circular(24),
                                border: Border.all(
                                    color: selected
                                        ? colors.primary
                                        : Colors.transparent,
                                    width: 1.5)),
                            padding: const EdgeInsets.all(16),
                            child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  ClipRRect(
                                      borderRadius: BorderRadius.circular(14),
                                      child: StitchImage(
                                          imageUrl: service.imageUrl,
                                          width: 72,
                                          height: 88)),
                                  const SizedBox(width: 14),
                                  Expanded(
                                      child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                        if (service.isPopular)
                                          Padding(
                                              padding: const EdgeInsets.only(
                                                  bottom: 6),
                                              child: Text('STUDIO FAVOURITE',
                                                  style: TextStyle(
                                                      fontSize: 9,
                                                      letterSpacing: 1,
                                                      color: colors.primary,
                                                      fontWeight:
                                                          FontWeight.w700))),
                                        Text(service.name,
                                            style: Theme.of(context)
                                                .textTheme
                                                .titleMedium
                                                ?.copyWith(
                                                    fontWeight:
                                                        FontWeight.w700)),
                                        if (service.description.isNotEmpty) ...[
                                          const SizedBox(height: 6),
                                          Text(service.description,
                                              maxLines: 3,
                                              overflow: TextOverflow.ellipsis,
                                              style: TextStyle(
                                                  fontSize: 12,
                                                  color:
                                                      colors.onSurfaceVariant)),
                                        ],
                                        const SizedBox(height: 12),
                                        Wrap(
                                            spacing: 12,
                                            runSpacing: 6,
                                            children: [
                                              Text('₹${service.price}',
                                                  style: const TextStyle(
                                                      fontWeight:
                                                          FontWeight.w700)),
                                              Text(service.duration,
                                                  style: TextStyle(
                                                      color: colors
                                                          .onSurfaceVariant,
                                                      fontSize: 12)),
                                            ]),
                                      ])),
                                  const SizedBox(width: 8),
                                  Icon(
                                      selected
                                          ? Icons.check_circle
                                          : Icons.add_circle_outline,
                                      color: selected
                                          ? colors.primary
                                          : colors.onSurfaceVariant),
                                ])))))));
  }
}
