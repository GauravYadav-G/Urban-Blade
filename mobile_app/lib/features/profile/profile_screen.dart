import 'package:flutter/material.dart';
import '../../core/widgets/active_listenable_builder.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/salon_constants.dart';
import '../../core/services/app_state.dart';
import '../../core/widgets/glass_panel.dart';
import '../../core/widgets/stitch_image.dart';
import '../../core/widgets/commerce_ui.dart';
import '../../core/widgets/entrance.dart';
import 'address_book_screen.dart';

class ProfileScreen extends StatelessWidget {
  final AppState state;
  final VoidCallback onOpenAppointments, onOpenOrders, onOpenLogin;
  final VoidCallback? onOpenPayments, onOpenReturns;
  const ProfileScreen({
    super.key,
    required this.state,
    required this.onOpenAppointments,
    required this.onOpenOrders,
    required this.onOpenLogin,
    this.onOpenPayments,
    this.onOpenReturns,
  });
  Future<void> _editProfile(BuildContext context) async {
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      sheetAnimationStyle: MediaQuery.disableAnimationsOf(context)
          ? AnimationStyle.noAnimation
          : const AnimationStyle(
              duration: Duration(milliseconds: 260),
              reverseDuration: Duration(milliseconds: 200),
            ),
      builder: (_) =>
          GlassPanel(radius: 28, child: _ProfileEditor(state: state)),
    );
  }

  Future<void> _openAddresses(BuildContext context) async {
    if (!state.isLoggedIn) {
      onOpenLogin();
      return;
    }
    await Navigator.push<void>(
      context,
      MaterialPageRoute(builder: (_) => AddressBookScreen(state: state)),
    );
  }

  Future<void> _refreshAccount() async {
    await Future.wait([state.loadHistory(), state.loadAddresses()]);
  }

  Future<void> _contact(BuildContext context) async {
    try {
      final ok = await launchUrl(
        Uri.parse(
          'https://wa.me/${SalonConstants.phoneClean.replaceAll('+', '')}',
        ),
        mode: LaunchMode.externalApplication,
      );
      if (!ok) throw StateError('Contact unavailable');
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

  @override
  Widget build(BuildContext context) => ActiveListenableBuilder(
    animation: state,
    builder: (context, _) {
      if (state.isRestoringSession) {
        return const Center(child: CircularProgressIndicator());
      }
      final scheme = Theme.of(context).colorScheme;
      final signedIn = state.isLoggedIn;
      final name = state.userName.trim();
      final initials = name.isEmpty
          ? 'UB'
          : name
                .split(RegExp(r'\s+'))
                .take(2)
                .map((part) => part[0])
                .join()
                .toUpperCase();
      Widget heading(String text, String description) => Padding(
        padding: const EdgeInsets.fromLTRB(0, 26, 0, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(text, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 5),
            Text(
              description,
              style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12),
            ),
          ],
        ),
      );
      return RefreshIndicator(
        onRefresh: _refreshAccount,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
          children: [
            const Text(
              'URBAN BLADE / YOUR SPACE',
              style: TextStyle(
                fontSize: 9,
                letterSpacing: 1.7,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              'My account',
              style: Theme.of(context).textTheme.headlineLarge,
            ),
            const SizedBox(height: 6),
            Text(
              'Your details, orders, and appointments.',
              style: TextStyle(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 22),
            Entrance(
              child: GlassPanel(
                liquid: true,
                radius: 24,
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        CircleAvatar(
                          radius: 26,
                          backgroundColor: scheme.primaryContainer,
                          child: Text(
                            signedIn ? initials : 'UB',
                            style: TextStyle(
                              color: scheme.onPrimaryContainer,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                signedIn
                                    ? state.userName
                                    : 'Make yourself at home.',
                                style: Theme.of(context).textTheme.titleLarge,
                              ),
                              const SizedBox(height: 6),
                              Text(
                                signedIn
                                    ? state.userEmail
                                    : 'Sign in to bring your account together.',
                                style: TextStyle(
                                  color: scheme.onSurfaceVariant,
                                  fontSize: 12,
                                ),
                              ),
                              if (signedIn && state.userPhone.isNotEmpty)
                                Padding(
                                  padding: const EdgeInsets.only(top: 5),
                                  child: Text(state.userPhone),
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 18),
                    FilledButton.icon(
                      onPressed: signedIn
                          ? () => _editProfile(context)
                          : onOpenLogin,
                      icon: Icon(
                        signedIn ? Icons.edit_outlined : Icons.login,
                        size: 18,
                      ),
                      label: Text(
                        signedIn ? 'Edit profile' : 'Sign in or create account',
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (signedIn) ...[
              heading(
                'Overview',
                'A little overview of everything you have with us.',
              ),
              LayoutBuilder(
                builder: (context, constraints) {
                  final wide =
                      constraints.maxWidth > 340 &&
                      MediaQuery.textScalerOf(context).scale(14) <= 21;
                  final metrics = [
                    ('Orders', '${state.orders.length}', onOpenOrders),
                    (
                      'Appointments',
                      '${state.bookings.where((b) => b.canReschedule).length}',
                      onOpenAppointments,
                    ),
                    (
                      'Saved addresses',
                      '${state.addresses.length}',
                      () => _openAddresses(context),
                    ),
                  ];
                  return Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: metrics
                        .map(
                          (entry) => SizedBox(
                            width: wide
                                ? (constraints.maxWidth - 20) / 3
                                : constraints.maxWidth,
                            child: GlassPanel(
                              radius: 16,
                              child: InkWell(
                                onTap: entry.$3,
                                child: Padding(
                                  padding: const EdgeInsets.all(14),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        state.isLoadingHistory ||
                                                state.isLoadingAddresses
                                            ? '…'
                                            : entry.$2,
                                        style: const TextStyle(
                                          fontSize: 24,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        entry.$1,
                                        style: TextStyle(
                                          fontSize: 11,
                                          color: scheme.onSurfaceVariant,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ),
                        )
                        .toList(),
                  );
                },
              ),
              if (state.historyError != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(
                    state.historyError!,
                    style: TextStyle(color: scheme.error),
                  ),
                ),
            ],
            heading('Account', 'Everything you need, in one place.'),
            GlassPanel(
              child: Column(
                children: [
                  _row(
                    Icons.person_outline,
                    'Account details',
                    'Manage your name, email and contact phone',
                    signedIn ? () => _editProfile(context) : onOpenLogin,
                  ),
                  const Divider(height: 1, indent: 60),
                  _row(
                    Icons.local_shipping_outlined,
                    'Orders & receipts',
                    'Follow deliveries and view your receipts',
                    signedIn ? onOpenOrders : onOpenLogin,
                  ),
                  const Divider(height: 1, indent: 60),
                  _row(
                    Icons.assignment_return_outlined,
                    'Returns & refunds',
                    'Request a return and track refund progress',
                    signedIn ? onOpenReturns ?? onOpenOrders : onOpenLogin,
                  ),
                  const Divider(height: 1, indent: 60),
                  _row(
                    Icons.calendar_today_outlined,
                    'Appointments',
                    'Your visits, bookings and rescheduling',
                    signedIn ? onOpenAppointments : onOpenLogin,
                  ),
                  const Divider(height: 1, indent: 60),
                  _row(
                    Icons.location_on_outlined,
                    'Address book',
                    'Save home, office and other delivery addresses',
                    () => _openAddresses(context),
                  ),
                  const Divider(height: 1, indent: 60),
                  _row(
                    Icons.receipt_long_outlined,
                    'Payment history',
                    'Payment records and receipts',
                    signedIn ? onOpenPayments ?? onOpenOrders : onOpenLogin,
                  ),
                  const Divider(height: 1, indent: 60),
                  _row(
                    Icons.favorite_border,
                    'Saved items',
                    '${state.wishlist.length} products saved for later',
                    () => _saved(context),
                  ),
                ],
              ),
            ),
            heading('Settings', 'Make Urban Blade feel like yours.'),
            GlassPanel(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Appearance',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Choose light, dark, or follow your device.',
                    style: TextStyle(
                      color: scheme.onSurfaceVariant,
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(height: 14),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final mode in const {
                        ThemeMode.light: 'Light',
                        ThemeMode.dark: 'Dark',
                        ThemeMode.system: 'System',
                      }.entries)
                        ChoiceChip(
                          label: Text(mode.value),
                          selected: state.themeMode == mode.key,
                          showCheckmark: false,
                          onSelected: (_) async {
                            try {
                              await state.setThemeMode(mode.key);
                            } catch (_) {
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text(
                                      'Appearance could not be saved. Please retry.',
                                    ),
                                  ),
                                );
                              }
                            }
                          },
                        ),
                    ],
                  ),
                ],
              ),
            ),
            heading('Help & support', 'We’re here when you need us.'),
            GlassPanel(
              child: _row(
                Icons.chat_bubble_outline,
                'Contact the studio',
                SalonConstants.phone,
                () => _contact(context),
              ),
            ),
            if (signedIn) ...[
              const SizedBox(height: 24),
              OutlinedButton.icon(
                onPressed: () async {
                  try {
                    await state.logout();
                  } catch (_) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text(
                            'Could not finish signing out. Please retry.',
                          ),
                        ),
                      );
                    }
                  }
                },
                icon: const Icon(Icons.logout, size: 18),
                label: const Text('Sign out'),
              ),
            ],
            const SizedBox(height: 24),
            Text(
              'URBAN BLADE · EVERYDAY, WELL GROOMED',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 9,
                letterSpacing: 1.2,
                color: scheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      );
    },
  );
  Widget _row(
    IconData icon,
    String title,
    String subtitle,
    VoidCallback onTap,
  ) => Builder(
    builder: (context) => ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 7),
      leading: GlassPanel(
        radius: 13,
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Icon(
            icon,
            size: 20,
            color: Theme.of(context).colorScheme.primary,
          ),
        ),
      ),
      title: Text(
        title,
        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
      ),
      subtitle: Text(
        subtitle,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(fontSize: 12, color: AppColors.of(context).secondary),
      ),
      trailing: const Icon(Icons.chevron_right, size: 20),
      onTap: onTap,
    ),
  );
  void _saved(BuildContext context) => showModalBottomSheet(
    context: context,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => GlassPanel(
      radius: 28,
      child: ActiveListenableBuilder(
        animation: state,
        builder: (context, _) {
          final products = state.products
              .where((p) => state.wishlist.contains(p.id))
              .toList();
          return ListView(
            padding: const EdgeInsets.all(24),
            children: [
              CommerceSheetHeader(
                title: 'Saved for later',
                icon: Icons.favorite_border,
                onClose: () => Navigator.pop(context),
              ),
              const SizedBox(height: 16),
              if (products.isEmpty)
                const Text('Tap the heart on a product to save it here.'),
              ...products.map(
                (p) => Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: GlassPanel(
                    radius: 18,
                    child: ListTile(
                      contentPadding: const EdgeInsets.all(12),
                      leading: StitchImage(
                        imageUrl: p.imageUrl,
                        width: 56,
                        height: 66,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      title: Text(p.name),
                      subtitle: Text('₹${p.price}'),
                      trailing: IconButton(
                        tooltip: 'Add to bag',
                        onPressed: !p.inStock || state.pendingPayment != null
                            ? null
                            : () {
                                state.addToCart(p);
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                    content: Text(
                                      '${p.name} added to your bag',
                                    ),
                                  ),
                                );
                              },
                        icon: const Icon(Icons.add_shopping_cart),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    ),
  );
}

class _ProfileEditor extends StatefulWidget {
  final AppState state;
  const _ProfileEditor({required this.state});
  @override
  State<_ProfileEditor> createState() => _ProfileEditorState();
}

class _ProfileEditorState extends State<_ProfileEditor> {
  late final _name = TextEditingController(text: widget.state.userName),
      _phone = TextEditingController(text: widget.state.userPhone);
  late final Object _session = widget.state.accountSessionKey;
  final _form = GlobalKey<FormState>();
  bool _busy = false;
  String? _error;
  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    super.dispose();
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
      return SafeArea(
        top: false,
        child: Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Form(
              key: _form,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  CommerceSheetHeader(
                    title: 'Your details',
                    icon: Icons.person_outline,
                    onClose: () => Navigator.pop(context),
                  ),
                  const SizedBox(height: 20),
                  TextFormField(
                    controller: _name,
                    autofillHints: const [AutofillHints.name],
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(labelText: 'Full name'),
                    validator: (v) => (v ?? '').trim().length < 2
                        ? 'Enter your full name'
                        : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    initialValue: widget.state.userEmail,
                    readOnly: true,
                    decoration: const InputDecoration(
                      labelText: 'Primary email address',
                      helperText:
                          'Registered email is linked to your order history and cannot be changed.',
                      helperMaxLines: 3,
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _phone,
                    autofillHints: const [AutofillHints.telephoneNumber],
                    keyboardType: TextInputType.phone,
                    textInputAction: TextInputAction.done,
                    decoration: const InputDecoration(
                      labelText: 'Mobile number',
                    ),
                    validator: (v) =>
                        (v ?? '').trim().isNotEmpty &&
                            !RegExp(r'^[6-9]\d{9}$').hasMatch((v ?? '').trim())
                        ? 'Enter a valid 10-digit number'
                        : null,
                  ),
                  const SizedBox(height: 16),
                  if (_error != null)
                    Text(
                      _error!,
                      style: TextStyle(color: AppColors.of(context).error),
                    ),
                  FilledButton(
                    onPressed: _busy
                        ? null
                        : () async {
                            if (!_form.currentState!.validate()) return;
                            setState(() {
                              _busy = true;
                              _error = null;
                            });
                            try {
                              await widget.state.updateProfile(
                                _name.text.trim(),
                                _phone.text.trim(),
                              );
                              if (context.mounted) {
                                Navigator.pop(context);
                              }
                            } catch (e) {
                              if (mounted) {
                                setState(() => _error = e.toString());
                              }
                            } finally {
                              if (mounted) {
                                setState(() => _busy = false);
                              }
                            }
                          },
                    child: Text(_busy ? 'Saving…' : 'Save changes'),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    },
  );
}
