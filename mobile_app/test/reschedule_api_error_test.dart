import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:urban_blade_mobile/core/services/api_service.dart';

void main() {
  for (final method in ['GET', 'PUT']) {
    test(
      'missing $method rescheduling route has an actionable message',
      () async {
        final suffix = method == 'GET'
            ? 'available-slots?date=2026-10-20'
            : 'schedule';
        final client = MockClient(
          (request) async => http.Response(
            jsonEncode({
              'message':
                  'Route ${request.method}:${request.url.path} not found',
              'error': 'Not Found',
              'statusCode': 404,
            }),
            404,
          ),
        );
        addTearDown(client.close);
        final api = ApiService(client: client)..authToken = 'customer-token';
        await expectLater(
          api.request(method, 'bookings/booking-1/$suffix'),
          throwsA(
            isA<ApiException>()
                .having((e) => e.code, 'code', 'RESCHEDULING_UNAVAILABLE')
                .having(
                  (e) => e.message,
                  'message',
                  contains('Your appointment has not changed'),
                )
                .having((e) => e.message, 'message', isNot(contains('Route '))),
          ),
        );
      },
    );
  }

  test('missing owned booking retains the server ownership message', () async {
    final client = MockClient(
      (_) async => http.Response(
        jsonEncode({'message': 'Appointment not found in your account.'}),
        404,
      ),
    );
    addTearDown(client.close);
    final api = ApiService(client: client)..authToken = 'customer-token';
    await expectLater(
      api.request('GET', 'bookings/booking-1/available-slots?date=2026-10-20'),
      throwsA(
        isA<ApiException>()
            .having((e) => e.code, 'code', isNull)
            .having(
              (e) => e.message,
              'message',
              'Appointment not found in your account.',
            ),
      ),
    );
  });

  test('occupied time retains the server conflict message', () async {
    final client = MockClient(
      (_) async => http.Response(
        jsonEncode({
          'message': 'This time is no longer available. Choose another slot.',
        }),
        409,
      ),
    );
    addTearDown(client.close);
    final api = ApiService(client: client)..authToken = 'customer-token';
    await expectLater(
      api.request('PUT', 'bookings/booking-1/schedule'),
      throwsA(
        isA<ApiException>()
            .having((e) => e.status, 'status', 409)
            .having(
              (e) => e.message,
              'message',
              contains('Choose another slot'),
            ),
      ),
    );
  });
}
