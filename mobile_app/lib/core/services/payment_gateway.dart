import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';

class PaymentResult {
  final String? paymentId, orderId, signature, error;
  final bool cancelled;
  final bool launchFailed;
  const PaymentResult(
      {this.paymentId,
      this.orderId,
      this.signature,
      this.error,
      this.cancelled = false,
      this.launchFailed = false});
  bool get succeeded =>
      paymentId != null && orderId != null && signature != null;
}

abstract class PaymentGateway {
  Future<PaymentResult> open(Map<String, dynamic> options);
  void dispose();
}

class RazorpayGateway implements PaymentGateway {
  Razorpay? _sdk;
  Completer<PaymentResult>? _pending;
  bool _disposed = false;
  void _finish(PaymentResult result) {
    if (_pending != null && !_pending!.isCompleted) _pending!.complete(result);
  }

  @override
  Future<PaymentResult> open(Map<String, dynamic> options) async {
    if (_disposed) {
      return const PaymentResult(
          launchFailed: true,
          error: 'Checkout has closed. Reopen the payment page to continue.');
    }
    if (kIsWeb ||
        ![TargetPlatform.android, TargetPlatform.iOS]
            .contains(defaultTargetPlatform)) {
      return const PaymentResult(
          launchFailed: true,
          error: 'Online payments are available in the Android and iOS app.');
    }
    if (_pending != null && !_pending!.isCompleted) {
      throw StateError('Checkout is already open.');
    }
    final pending = Completer<PaymentResult>();
    _pending = pending;
    // The upstream SDK exposes `void open(...) async`; an ordinary try/catch
    // cannot observe errors from its awaited native channel. Keep that async
    // work in an error zone so launch failures always release the checkout UI.
    runZonedGuarded(() {
      _sdk ??= Razorpay()
        ..on(
            Razorpay.EVENT_PAYMENT_SUCCESS,
            (PaymentSuccessResponse response) => _finish(PaymentResult(
                paymentId: response.paymentId,
                orderId: response.orderId,
                signature: response.signature)))
        ..on(
            Razorpay.EVENT_PAYMENT_ERROR,
            (PaymentFailureResponse response) => _finish(PaymentResult(
                error: response.message ?? 'Payment was not completed.',
                cancelled: response.code == Razorpay.PAYMENT_CANCELLED)))
        ..on(
            Razorpay.EVENT_EXTERNAL_WALLET,
            (ExternalWalletResponse response) => _finish(const PaymentResult(
                error:
                    'Check your payment status after completing payment in your wallet.')));
      _sdk!.open(options);
    }, (Object error, StackTrace stack) {
      if (!identical(_pending, pending) || pending.isCompleted) return;
      _finish(PaymentResult(
          launchFailed: true,
          error: error is MissingPluginException
              ? 'Secure checkout is unavailable in this installation. Reinstall the latest app and retry.'
              : 'Could not open secure checkout. Try again or choose another payment method.'));
    });
    return pending.future;
  }

  @override
  void dispose() {
    _disposed = true;
    _sdk?.clear();
    _finish(const PaymentResult(cancelled: true));
  }
}

/// Razorpay owns app discovery, intent handoff and payment callbacks.
/// Keep the default methods available when a preferred app is not installed.
Map<String, Object> upiCheckoutConfiguration(String app) => {
      'display': {
        'blocks': {
          'preferred_upi': {
            'name': app == 'phonepe'
                ? 'PhonePe'
                : app == 'google_pay'
                    ? 'Google Pay'
                    : 'Pay with UPI',
            'instruments': [
              {
                'method': 'upi',
                'flows': ['intent'],
                if (app == 'phonepe' || app == 'google_pay') 'apps': [app]
              },
            ],
          },
        },
        'sequence': ['block.preferred_upi'],
        'preferences': {'show_default_blocks': true},
      },
    };
