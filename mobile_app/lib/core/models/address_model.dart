class SavedAddress {
  final String id,
      fullName,
      mobile,
      house,
      street,
      landmark,
      pinCode,
      city,
      region;
  final bool isDefault;
  final Map<String, Object?>? location;
  const SavedAddress({
    this.id = '',
    required this.fullName,
    required this.mobile,
    this.house = '',
    required this.street,
    this.landmark = '',
    required this.pinCode,
    required this.city,
    required this.region,
    this.isDefault = false,
    this.location,
  });

  String get streetLine =>
      [house, street, landmark].where((s) => s.trim().isNotEmpty).join(', ');
  String get fullAddress => '$streetLine, $city, $region $pinCode';
  Map<String, Object?> toJson() => {
    'fullName': fullName,
    'mobile': mobile,
    'house': house,
    'street': street,
    'landmark': landmark,
    'pinCode': pinCode,
    'city': city,
    'state': region,
    'isDefault': isDefault,
    'location': location,
  };
  factory SavedAddress.fromJson(Map<String, dynamic> json) {
    for (final key in [
      'id',
      'fullName',
      'mobile',
      'street',
      'pinCode',
      'city',
      'state',
    ]) {
      if (json[key] is! String || (json[key] as String).trim().isEmpty) {
        throw const FormatException(
          'The address book could not be read. Please retry.',
        );
      }
    }
    final location = json['location'];
    if (location != null &&
        (location is! Map ||
            location['lat'] is! num ||
            location['lng'] is! num ||
            !(location['lat'] as num).isFinite ||
            !(location['lng'] as num).isFinite)) {
      throw const FormatException('The saved map location could not be read.');
    }
    return SavedAddress(
      id: json['id'],
      fullName: json['fullName'],
      mobile: json['mobile'],
      house: json['house'] is String ? json['house'] : '',
      street: json['street'],
      landmark: json['landmark'] is String ? json['landmark'] : '',
      pinCode: json['pinCode'],
      city: json['city'],
      region: json['state'],
      isDefault: json['isDefault'] == true,
      location: location is Map ? Map<String, Object?>.from(location) : null,
    );
  }
}
