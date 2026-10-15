const returnReasons = [
  'Damaged or defective product',
  'Wrong product delivered',
  'Missing or incorrect items',
  'Product quality concern',
  'Other reason',
];

class OrderAftercare {
  final String? returnStatus,
      returnReason,
      reviewNote,
      refundStatus,
      refundId,
      refundFailureReason,
      refundExternalReference,
      paymentReview;
  final DateTime? requestedAt, reviewedAt, receivedAt, refundedAt;
  final num? refundAmount, confirmedRefundAmount;
  const OrderAftercare({
    this.returnStatus,
    this.returnReason,
    this.reviewNote,
    this.refundStatus,
    this.refundId,
    this.refundFailureReason,
    this.refundExternalReference,
    this.paymentReview,
    this.requestedAt,
    this.reviewedAt,
    this.receivedAt,
    this.refundedAt,
    this.refundAmount,
    this.confirmedRefundAmount,
  });
  bool get hasRecord =>
      returnStatus != null || refundStatus != null || (refundAmount ?? 0) > 0;
  String get returnLabel => switch (returnStatus) {
    'requested' => 'Awaiting review',
    'approved' => 'Approved · awaiting parcel',
    'rejected' => 'Return declined',
    'received' => 'Received & inspected',
    _ => 'Return status unavailable',
  };
  String get refundLabel => switch (refundStatus) {
    'pending' => 'Refund processing',
    'processed' => 'Refund completed',
    'failed' => 'Refund needs attention',
    _ => 'Refund not started',
  };
  factory OrderAftercare.fromJson(Map<String, dynamic> json) {
    String? text(String key) =>
        json[key] is String && (json[key] as String).trim().isNotEmpty
        ? json[key] as String
        : null;
    DateTime? date(String key) => DateTime.tryParse(text(key) ?? '');
    num? amount(String key) {
      final value = num.tryParse('${json[key]}');
      if (json[key] != null &&
          (value == null || !value.isFinite || value < 0)) {
        throw const FormatException(
          'The refund amount could not be read. Please refresh.',
        );
      }
      return value;
    }

    final status = text('return_status');
    final refund = text('refund_status');
    if (status != null &&
            ![
              'requested',
              'approved',
              'rejected',
              'received',
            ].contains(status) ||
        refund != null &&
            !['pending', 'processed', 'failed'].contains(refund)) {
      throw const FormatException(
        'The return status could not be read. Please refresh.',
      );
    }
    return OrderAftercare(
      returnStatus: status,
      returnReason: text('return_reason'),
      reviewNote: text('return_review_note'),
      refundStatus: refund,
      refundId: text('refund_id'),
      refundFailureReason: text('refund_failure_reason'),
      refundExternalReference: text('refund_external_reference'),
      paymentReview: text('payment_reconciliation_error'),
      requestedAt: date('return_requested_at'),
      reviewedAt: date('return_reviewed_at'),
      receivedAt: date('return_received_at'),
      refundedAt: date('refunded_at'),
      refundAmount: amount('refund_amount'),
      confirmedRefundAmount: amount('confirmed_refund_amount'),
    );
  }
}

class ReturnEvent {
  final String id, status, note;
  final DateTime? createdAt;
  const ReturnEvent({
    required this.id,
    required this.status,
    required this.note,
    this.createdAt,
  });
  factory ReturnEvent.fromJson(Map<String, dynamic> json) {
    if (json['id'] is! String ||
        ![
          'requested',
          'approved',
          'rejected',
          'received',
        ].contains(json['status'])) {
      throw const FormatException(
        'The return timeline could not be read. Please refresh.',
      );
    }
    return ReturnEvent(
      id: json['id'],
      status: json['status'],
      note: json['note'] is String ? json['note'] : '',
      createdAt: DateTime.tryParse('${json['created_at']}'),
    );
  }
}
