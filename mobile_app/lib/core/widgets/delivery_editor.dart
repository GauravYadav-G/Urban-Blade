import 'package:flutter/material.dart';
import '../../features/profile/address_book_screen.dart';
import '../services/app_state.dart';
import 'glass_panel.dart';
import 'commerce_ui.dart';

Future<bool> editDeliveryAddress(BuildContext context, AppState state) async {
  if (state.isLoggedIn) {
    return await Navigator.push<bool>(
          context,
          MaterialPageRoute(
            builder: (_) =>
                AddressBookScreen(state: state, selectForCheckout: true),
          ),
        ) ??
        false;
  }
  return await showModalBottomSheet<bool>(
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
            GlassPanel(radius: 28, child: _DeliveryForm(state: state)),
      ) ??
      false;
}

class _DeliveryForm extends StatefulWidget {
  final AppState state;
  const _DeliveryForm({required this.state});
  @override
  State<_DeliveryForm> createState() => _DeliveryFormState();
}

class _DeliveryFormState extends State<_DeliveryForm> {
  final _form = GlobalKey<FormState>();
  late final List<TextEditingController> _fields;
  bool _saving = false;
  String? _saveError;
  @override
  void initState() {
    super.initState();
    final s = widget.state;
    _fields = [
      s.deliveryName.isEmpty
          ? s.userName == 'Guest'
                ? ''
                : s.userName
          : s.deliveryName,
      s.deliveryPhone.isEmpty ? s.userPhone : s.deliveryPhone,
      s.homeAddress,
      s.city,
      s.region,
      s.postalCode,
    ].map((v) => TextEditingController(text: v)).toList();
  }

  @override
  void dispose() {
    for (final field in _fields) {
      field.dispose();
    }
    super.dispose();
  }

  Future<void> _saveDelivery() async {
    if (_saving || !(_form.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _saving = true;
      _saveError = null;
    });
    try {
      await widget.state.saveDelivery(
        name: _fields[0].text.trim(),
        phone: _fields[1].text.trim(),
        street: _fields[2].text.trim(),
        newCity: _fields[3].text.trim(),
        newRegion: _fields[4].text.trim(),
        pin: _fields[5].text.trim(),
      );
      if (mounted) Navigator.pop(context, true);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _saveError = 'Could not save your delivery details. Please try again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
    child: SafeArea(
      top: false,
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Form(
          key: _form,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              CommerceSheetHeader(
                title: 'Where should we deliver?',
                icon: Icons.location_on_outlined,
                onClose: () => Navigator.pop(context, false),
              ),
              const SizedBox(height: 12),
              Text(
                'Your details are saved on this device for your next visit.',
                style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 20),
              ...List.generate(
                6,
                (i) => Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: TextFormField(
                    enabled: !_saving,
                    controller: _fields[i],
                    textCapitalization: i == 0 || i == 3 || i == 4
                        ? TextCapitalization.words
                        : TextCapitalization.none,
                    keyboardType: i == 1
                        ? TextInputType.phone
                        : i == 5
                        ? TextInputType.number
                        : i == 2
                        ? TextInputType.streetAddress
                        : TextInputType.text,
                    textInputAction: i == 5
                        ? TextInputAction.done
                        : TextInputAction.next,
                    onFieldSubmitted: i == 5 ? (_) => _saveDelivery() : null,
                    autofillHints: [
                      [AutofillHints.name],
                      [AutofillHints.telephoneNumber],
                      [AutofillHints.streetAddressLine1],
                      [AutofillHints.addressCity],
                      [AutofillHints.addressState],
                      [AutofillHints.postalCode],
                    ][i],
                    decoration: InputDecoration(
                      errorMaxLines: 3,
                      labelText: [
                        'Full name',
                        'Mobile number',
                        'Building and street',
                        'City',
                        'State',
                        'PIN code',
                      ][i],
                    ),
                    validator: (value) {
                      final v = (value ?? '').trim();
                      if (v.length < (i == 2 ? 5 : 2)) {
                        return 'Please complete this field';
                      }
                      if (i == 1 && !RegExp(r'^[6-9]\d{9}$').hasMatch(v)) {
                        return 'Enter a 10-digit Indian mobile number';
                      }
                      if (i == 5 && !RegExp(r'^[1-9]\d{5}$').hasMatch(v)) {
                        return 'Enter a valid 6-digit PIN code';
                      }
                      return null;
                    },
                  ),
                ),
              ),
              if (_saveError != null) ...[
                Semantics(
                  liveRegion: true,
                  child: Text(
                    _saveError!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
              ],
              FilledButton(
                onPressed: _saving ? null : _saveDelivery,
                child: _saving
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Save delivery details'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
