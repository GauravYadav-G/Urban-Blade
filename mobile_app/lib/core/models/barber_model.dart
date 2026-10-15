class BarberModel {
  final String id;
  final String name;
  final String title;
  final double rating;
  final int reviewsCount;
  final String avatarUrl;
  final String experience;
  final String bio;
  final List<String> specialties;

  const BarberModel({
    required this.id,
    required this.name,
    required this.title,
    this.rating = 4.9,
    this.reviewsCount = 350,
    required this.avatarUrl,
    required this.experience,
    required this.bio,
    this.specialties = const [],
  });

  factory BarberModel.fromJson(Map<String, dynamic> json) {
    return BarberModel(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      title: json['title'] as String? ?? 'Master Stylist',
      rating: (json['rating'] as num?)?.toDouble() ?? 4.9,
      reviewsCount: (json['reviewsCount'] as num?)?.toInt() ?? 300,
      avatarUrl: json['avatarUrl'] as String? ?? '',
      experience: json['experience'] as String? ?? '8+ years',
      bio: json['bio'] as String? ?? '',
      specialties: (json['specialties'] as List<dynamic>?)
              ?.map((e) => e.toString())
              .toList() ??
          [],
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'title': title,
        'rating': rating,
        'reviewsCount': reviewsCount,
        'avatarUrl': avatarUrl,
        'experience': experience,
        'bio': bio,
        'specialties': specialties,
      };
}
