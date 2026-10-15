import '../../core/widgets/premium_scaffold.dart';
import 'package:flutter/material.dart';
import '../../core/services/app_state.dart';
import '../../core/widgets/glass_panel.dart';
import '../../core/widgets/stitch_image.dart';

class LoginScreen extends StatefulWidget {
  final AppState state;
  final VoidCallback onLoginSuccess;
  const LoginScreen(
      {super.key, required this.state, required this.onLoginSuccess});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController(),
      _password = TextEditingController(),
      _name = TextEditingController(),
      _phone = TextEditingController();
  bool _register = false, _busy = false, _obscure = true;
  String? _error;
  @override
  void dispose() {
    for (final c in [_email, _password, _name, _phone]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy || !(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.state.signIn(
          email: _email.text,
          password: _password.text,
          name: _register ? _name.text : null,
          phone: _register ? _phone.text : null);
      if (mounted) widget.onLoginSuccess();
    } catch (e) {
      if (mounted) {
        setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => PremiumScaffold(
        appBar:
            AppBar(title: Text(_register ? 'Create account' : 'Welcome back')),
        body: SafeArea(
          top: false,
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                child: GlassPanel(
                  radius: 30,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const _AccountEditorial(),
                      Padding(
                        padding: const EdgeInsets.all(20),
                        child: Form(
                            key: _form,
                            child: AutofillGroup(
                                child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.stretch,
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                  Text(
                                      _register
                                          ? 'Your next ritual starts here'
                                          : 'Your Urban Blade account',
                                      style: Theme.of(context)
                                          .textTheme
                                          .headlineSmall),
                                  const SizedBox(height: 8),
                                  const Text(
                                      'Your appointments, essentials and everyday rituals, all in one place.'),
                                  const SizedBox(height: 24),
                                  if (_register) ...[
                                    TextFormField(
                                        controller: _name,
                                        autofillHints: const [
                                          AutofillHints.name
                                        ],
                                        textCapitalization:
                                            TextCapitalization.words,
                                        textInputAction: TextInputAction.next,
                                        decoration: const InputDecoration(
                                            labelText: 'Full name'),
                                        validator: (v) =>
                                            (v ?? '').trim().length < 2
                                                ? 'Enter your name'
                                                : null),
                                    const SizedBox(height: 12),
                                    TextFormField(
                                        controller: _phone,
                                        autofillHints: const [
                                          AutofillHints.telephoneNumberNational
                                        ],
                                        textInputAction: TextInputAction.next,
                                        keyboardType: TextInputType.phone,
                                        decoration: const InputDecoration(
                                            labelText:
                                                '10-digit mobile number'),
                                        validator: (v) =>
                                            !RegExp(r'^[6-9]\d{9}$')
                                                    .hasMatch(v ?? '')
                                                ? 'Enter a valid mobile number'
                                                : null),
                                    const SizedBox(height: 12),
                                  ],
                                  TextFormField(
                                      controller: _email,
                                      textInputAction: TextInputAction.next,
                                      autocorrect: false,
                                      autofillHints: const [
                                        AutofillHints.email
                                      ],
                                      keyboardType: TextInputType.emailAddress,
                                      decoration: const InputDecoration(
                                          labelText: 'Email'),
                                      validator: (v) =>
                                          !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
                                                  .hasMatch((v ?? '').trim())
                                              ? 'Enter a valid email'
                                              : null),
                                  const SizedBox(height: 12),
                                  TextFormField(
                                      controller: _password,
                                      textInputAction: TextInputAction.done,
                                      autocorrect: false,
                                      enableSuggestions: false,
                                      obscureText: _obscure,
                                      autofillHints: [
                                        _register
                                            ? AutofillHints.newPassword
                                            : AutofillHints.password
                                      ],
                                      decoration: InputDecoration(
                                          labelText: 'Password',
                                          helperText: _register
                                              ? 'At least 10 characters'
                                              : null,
                                          suffixIcon: IconButton(
                                              tooltip: _obscure
                                                  ? 'Show password'
                                                  : 'Hide password',
                                              onPressed: () => setState(
                                                  () => _obscure = !_obscure),
                                              icon: Icon(_obscure
                                                  ? Icons.visibility_outlined
                                                  : Icons
                                                      .visibility_off_outlined))),
                                      validator: (v) => (v ?? '').length <
                                              (_register ? 10 : 1)
                                          ? 'Enter ${_register ? 'at least 10 characters' : 'your password'}'
                                          : null,
                                      onFieldSubmitted: (_) {
                                        if (!_busy) _submit();
                                      }),
                                  if (_error != null)
                                    Padding(
                                        padding: const EdgeInsets.symmetric(
                                            vertical: 12),
                                        child: Text(_error!,
                                            style: TextStyle(
                                                color: Theme.of(context)
                                                    .colorScheme
                                                    .error))),
                                  const SizedBox(height: 24),
                                  FilledButton(
                                      onPressed: _busy ? null : _submit,
                                      child: _busy
                                          ? const SizedBox(
                                              width: 20,
                                              height: 20,
                                              child: CircularProgressIndicator(
                                                  strokeWidth: 2))
                                          : Text(_register
                                              ? 'Create account'
                                              : 'Sign in')),
                                  TextButton(
                                      onPressed: _busy
                                          ? null
                                          : () => setState(() {
                                                _register = !_register;
                                                _error = null;
                                              }),
                                      child: Text(_register
                                          ? 'Already have an account? Sign in'
                                          : 'New here? Create an account')),
                                  TextButton(
                                      onPressed: _busy
                                          ? null
                                          : () => Navigator.pop(context),
                                      child: const Text(
                                          'Explore without signing in')),
                                ]))),
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

class _AccountEditorial extends StatelessWidget {
  const _AccountEditorial();

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 152,
        child: Stack(
          fit: StackFit.expand,
          children: [
            const ExcludeSemantics(
              child: StitchImage(
                imageUrl: 'assets/images/heroes/care-editorial.png',
                fit: BoxFit.cover,
              ),
            ),
            Positioned(
              left: 16,
              bottom: 16,
              child: GlassPanel(
                radius: 24,
                blur: true,
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.content_cut_rounded,
                        size: 16,
                        color: Theme.of(context).colorScheme.onSurface),
                    const SizedBox(width: 8),
                    const Text('URBAN BLADE',
                        style: TextStyle(
                            fontSize: 10,
                            letterSpacing: 1.6,
                            fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
            ),
          ],
        ),
      );
}
