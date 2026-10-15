import 'package:flutter/material.dart';
import '../../core/models/address_model.dart';
import '../../core/services/app_state.dart';
import '../../core/widgets/glass_panel.dart';
import '../../core/widgets/premium_scaffold.dart';
import '../../core/widgets/commerce_ui.dart';

class AddressBookScreen extends StatefulWidget {
  final AppState state;
  final bool selectForCheckout;
  const AddressBookScreen({
    super.key,
    required this.state,
    this.selectForCheckout = false,
  });
  @override
  State<AddressBookScreen> createState() => _AddressBookScreenState();
}

class _AddressBookScreenState extends State<AddressBookScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.state.loadAddresses();
    });
  }

  Future<void> _edit([SavedAddress? address]) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => GlassPanel(
        radius: 28,
        child: _AddressEditor(state: widget.state, address: address),
      ),
    );
  }

  Future<void> _run(Future<void> Function() change) async {
    try {
      await change();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
  }

  Future<void> _remove(SavedAddress address) async {
    final session = widget.state.accountSessionKey;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remove this address?'),
        content: const Text(
          'This removes the saved address from your account. Existing orders keep their delivery details.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep address'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed == true &&
        mounted &&
        session == widget.state.accountSessionKey) {
      await _run(() => widget.state.removeAddress(address.id));
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.state,
    builder: (context, _) {
      final state = widget.state;
      return PremiumScaffold(
        appBar: AppBar(
          title: Text(
            widget.selectForCheckout
                ? 'Choose delivery address'
                : 'Address book',
          ),
        ),
        body: !state.isLoggedIn
            ? const Center(
                child: Text('Sign in to manage your saved addresses.'),
              )
            : RefreshIndicator(
                onRefresh: state.loadAddresses,
                child: ListView.builder(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(20),
                  itemCount: state.addresses.length + 1,
                  itemBuilder: (context, index) {
                    if (index == 0) {
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            'Ready for your next delivery.',
                            style: Theme.of(context).textTheme.headlineSmall,
                          ),
                          const SizedBox(height: 8),
                          const Text(
                            'Your saved addresses are shared with the website. Choose a different address for each delivery.',
                          ),
                          const SizedBox(height: 16),
                          FilledButton.icon(
                            onPressed: state.isSavingAddress
                                ? null
                                : () => _edit(),
                            icon: const Icon(Icons.add),
                            label: const Text('Add new address'),
                          ),
                          if (state.isLoadingAddresses)
                            const Padding(
                              padding: EdgeInsets.symmetric(vertical: 12),
                              child: LinearProgressIndicator(),
                            ),
                          if (state.addressesError != null)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 12),
                              child: Column(
                                children: [
                                  Text(
                                    state.addressesError!,
                                    style: TextStyle(
                                      color: Theme.of(
                                        context,
                                      ).colorScheme.error,
                                    ),
                                  ),
                                  TextButton(
                                    onPressed: state.loadAddresses,
                                    child: const Text('Retry address book'),
                                  ),
                                ],
                              ),
                            ),
                          if (state.addresses.isEmpty &&
                              !state.isLoadingAddresses)
                            const Padding(
                              padding: EdgeInsets.symmetric(vertical: 32),
                              child: Text(
                                'No saved addresses yet. Add your home, office, or another delivery location.',
                              ),
                            ),
                          const SizedBox(height: 20),
                        ],
                      );
                    }
                    final address = state.addresses[index - 1];
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: GlassPanel(
                        padding: const EdgeInsets.all(18),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Wrap(
                              spacing: 10,
                              runSpacing: 8,
                              crossAxisAlignment: WrapCrossAlignment.center,
                              children: [
                                Text(
                                  address.fullName,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w700,
                                    fontSize: 16,
                                  ),
                                ),
                                if (address.isDefault)
                                  const StatusPill('Default'),
                                if (state.selectedDeliveryAddressId ==
                                    address.id)
                                  const StatusPill('Selected for delivery'),
                              ],
                            ),
                            const SizedBox(height: 10),
                            Text(address.mobile),
                            const SizedBox(height: 8),
                            Text(address.fullAddress),
                            const SizedBox(height: 14),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                FilledButton.tonal(
                                  onPressed: state.isSavingAddress
                                      ? null
                                      : () => _run(() async {
                                          await state.useSavedAddress(address);
                                          if (context.mounted &&
                                              widget.selectForCheckout) {
                                            Navigator.pop(context, true);
                                          }
                                        }),
                                  child: const Text('Use for delivery'),
                                ),
                                TextButton(
                                  onPressed: state.isSavingAddress
                                      ? null
                                      : () => _edit(address),
                                  child: const Text('Edit'),
                                ),
                                if (!address.isDefault)
                                  TextButton(
                                    onPressed: state.isSavingAddress
                                        ? null
                                        : () => _run(
                                            () => state.setDefaultAddress(
                                              address.id,
                                            ),
                                          ),
                                    child: const Text('Make default'),
                                  ),
                                TextButton(
                                  onPressed: state.isSavingAddress
                                      ? null
                                      : () => _remove(address),
                                  child: const Text('Remove'),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
      );
    },
  );
}

class _AddressEditor extends StatefulWidget {
  final AppState state;
  final SavedAddress? address;
  const _AddressEditor({required this.state, this.address});
  @override
  State<_AddressEditor> createState() => _AddressEditorState();
}

class _AddressEditorState extends State<_AddressEditor> {
  final _form = GlobalKey<FormState>();
  late final Object _session = widget.state.accountSessionKey;
  late final List<TextEditingController> _fields = [
    widget.address?.fullName ?? widget.state.userName,
    widget.address?.mobile ?? widget.state.userPhone,
    widget.address?.house ?? '',
    widget.address?.street ?? '',
    widget.address?.landmark ?? '',
    widget.address?.pinCode ?? '',
    widget.address?.city ?? '',
    widget.address?.region ?? '',
  ].map((value) => TextEditingController(text: value)).toList();
  late bool _default =
      widget.address?.isDefault ?? widget.state.addresses.isEmpty;
  bool _busy = false;
  String? _error;
  @override
  void dispose() {
    for (final controller in _fields) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_busy || !(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.state.saveAddress(
        SavedAddress(
          id: widget.address?.id ?? '',
          fullName: _fields[0].text.trim(),
          mobile: _fields[1].text.trim(),
          house: _fields[2].text.trim(),
          street: _fields[3].text.trim(),
          landmark: _fields[4].text.trim(),
          pinCode: _fields[5].text.trim(),
          city: _fields[6].text.trim(),
          region: _fields[7].text.trim(),
          isDefault: _default,
          location: widget.address?.location,
        ),
      );
      if (mounted && _session == widget.state.accountSessionKey) {
        Navigator.pop(context);
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
      const labels = [
        'Full name',
        'Mobile number',
        'House / building',
        'Street',
        'Landmark (optional)',
        'PIN code',
        'City',
        'State',
      ];
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
                    title: widget.address == null
                        ? 'Add address'
                        : 'Edit address',
                    icon: Icons.location_on_outlined,
                    onClose: _busy ? () {} : () => Navigator.pop(context),
                  ),
                  const SizedBox(height: 16),
                  for (var i = 0; i < labels.length; i++)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 14),
                      child: TextFormField(
                        controller: _fields[i],
                        enabled: !_busy,
                        textInputAction: i == 7
                            ? TextInputAction.done
                            : TextInputAction.next,
                        keyboardType: i == 1
                            ? TextInputType.phone
                            : i == 5
                            ? TextInputType.number
                            : TextInputType.text,
                        maxLength: [100, 10, 255, 500, 255, 6, 100, 100][i],
                        decoration: InputDecoration(
                          labelText: labels[i],
                          counterText: '',
                          errorMaxLines: 3,
                        ),
                        validator: (value) {
                          final text = (value ?? '').trim();
                          if (i == 2 || i == 4) return null;
                          if (i == 1 &&
                              !RegExp(r'^[6-9]\d{9}$').hasMatch(text)) {
                            return 'Enter a 10-digit Indian mobile number';
                          }
                          if (i == 5 &&
                              !RegExp(r'^[1-9]\d{5}$').hasMatch(text)) {
                            return 'Enter a valid 6-digit PIN code';
                          }
                          if (text.length < (i == 0 || i == 6 ? 2 : 1)) {
                            return 'Please complete this field';
                          }
                          return null;
                        },
                      ),
                    ),
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    value: _default,
                    onChanged: _busy
                        ? null
                        : (value) => setState(() => _default = value ?? false),
                    title: const Text('Make this my default address'),
                  ),
                  if (_error != null)
                    Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  FilledButton(
                    onPressed: _busy ? null : _save,
                    child: Text(_busy ? 'Saving…' : 'Save address'),
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
