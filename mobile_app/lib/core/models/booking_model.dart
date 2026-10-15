import 'service_model.dart';
import 'barber_model.dart';

enum BookingStatus { confirmed, inProgress, completed, cancelled }

class BookingModel {
  final String id;
  final ServiceModel service;
  final BarberModel barber;
  final String locationType; // 'studio' | 'home'
  final String studioOrHomeAddress;
  final String date;
  final String timeSlot;
  final String? promoCode;
  final int discount;
  final int homeVisitFee;
  final int totalAmount;
  final BookingStatus status;
  final DateTime createdAt;

  const BookingModel({
    required this.id,
    required this.service,
    required this.barber,
    required this.locationType,
    required this.studioOrHomeAddress,
    required this.date,
    required this.timeSlot,
    this.promoCode,
    this.discount = 0,
    this.homeVisitFee = 0,
    required this.totalAmount,
    this.status = BookingStatus.confirmed,
    required this.createdAt,
  });

  bool get canReschedule {
    if (status != BookingStatus.confirmed) return false;
    final day = DateTime.tryParse(date);
    final match = RegExp(
      r'^(\d{1,2}):(\d{2})\s*(AM|PM)$',
      caseSensitive: false,
    ).firstMatch(timeSlot.trim());
    if (day == null || match == null) return false;
    final hour =
        int.parse(match[1]!) % 12 + (match[3]!.toUpperCase() == 'PM' ? 12 : 0);
    return DateTime.utc(
          day.year,
          day.month,
          day.day,
          hour,
          int.parse(match[2]!),
        )
        .subtract(const Duration(hours: 5, minutes: 30))
        .isAfter(DateTime.now().toUtc());
  }

  BookingModel withSchedule(String newDate, String newSlot) => BookingModel(
    id: id,
    service: service,
    barber: barber,
    locationType: locationType,
    studioOrHomeAddress: studioOrHomeAddress,
    date: newDate,
    timeSlot: newSlot,
    promoCode: promoCode,
    discount: discount,
    homeVisitFee: homeVisitFee,
    totalAmount: totalAmount,
    status: status,
    createdAt: createdAt,
  );

  String get statusDisplay {
    switch (status) {
      case BookingStatus.confirmed:
        return 'Confirmed';
      case BookingStatus.inProgress:
        return 'In Progress';
      case BookingStatus.completed:
        return 'Completed';
      case BookingStatus.cancelled:
        return 'Cancelled';
    }
  }
}
