class ServiceModel {
  final String id;
  final String name;
  final String duration;
  final int price;
  final int? compareAtPrice;
  final String description;
  final List<String> tags;
  final bool isPopular;
  final String
      category; // 'hair', 'beard', 'styling', 'color', 'facial', 'packages'
  final String imageUrl;

  const ServiceModel({
    required this.id,
    required this.name,
    required this.duration,
    required this.price,
    this.compareAtPrice,
    required this.description,
    this.tags = const [],
    this.isPopular = false,
    required this.category,
    this.imageUrl = '',
  });

  factory ServiceModel.fromJson(Map<String, dynamic> json) {
    return ServiceModel(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      duration: json['duration'] as String? ?? '45 min',
      price: (json['price'] as num?)?.toInt() ?? 499,
      compareAtPrice: (json['compareAtPrice'] as num?)?.toInt(),
      description: json['description'] as String? ?? '',
      tags:
          (json['tags'] as List<dynamic>?)?.map((e) => e.toString()).toList() ??
              [],
      isPopular: json['isPopular'] as bool? ?? false,
      category: json['category'] as String? ?? 'hair',
      imageUrl: json['imageUrl'] as String? ?? '',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'duration': duration,
      'price': price,
      'compareAtPrice': compareAtPrice,
      'description': description,
      'tags': tags,
      'isPopular': isPopular,
      'category': category,
      'imageUrl': imageUrl,
    };
  }
}
