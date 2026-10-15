import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:urban_blade_mobile/core/services/payment_gateway.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('razorpay_flutter');
  const options = {
    'key': 'rzp_live_example',
    'order_id': 'order_test',
    'amount': 44900
  };
  setUp(() => debugDefaultTargetPlatformOverride = TargetPlatform.android);
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test(
      'async native launch failure releases the waiting checkout and permits retry',
      () async {
    var launches = 0;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'resync') return null;
      launches++;
      if (launches == 1) throw PlatformException(code: 'checkout_failed');
      return {
        'type': 1,
        'data': {'code': 2, 'message': 'Checkout closed'}
      };
    });
    final gateway = RazorpayGateway();
    addTearDown(gateway.dispose);
    final failed =
        await gateway.open(options).timeout(const Duration(seconds: 2));
    expect(failed.launchFailed, isTrue);
    expect(failed.succeeded, isFalse);
    final retried =
        await gateway.open(options).timeout(const Duration(seconds: 2));
    expect(retried.cancelled, isTrue);
    expect(launches, 2);
  });

  test('only one native checkout opens while a payment is pending', () async {
    final native = Completer<Map<String, Object>>();
    var launches = 0;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'resync') return null;
      launches++;
      return native.future;
    });
    final gateway = RazorpayGateway();
    addTearDown(gateway.dispose);
    final first = gateway.open(options);
    await expectLater(gateway.open(options), throwsStateError);
    native.complete({
      'type': 1,
      'data': {'code': 2, 'message': 'Closed'}
    });
    expect((await first).cancelled, isTrue);
    expect(launches, 1);
  });

  test('disposing completes outstanding work and prevents reopening', () async {
    final native = Completer<Map<String, Object>>();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel,
            (call) async => call.method == 'resync' ? null : native.future);
    final gateway = RazorpayGateway();
    final opened = gateway.open(options);
    gateway.dispose();
    expect((await opened).cancelled, isTrue);
    expect((await gateway.open(options)).launchFailed, isTrue);
    native.complete({
      'type': 1,
      'data': {'code': 2, 'message': 'Closed'}
    });
  });
}
