class ProductModel {
  final String id;
  final String name;
  final int price;
  final int? compareAtPrice;
  final double rating;
  final int reviewCount;
  final String imageUrl;
  final String category; // 'hair', 'beard', 'face', 'fragrance', 'tools'
  final String? badge; // 'Best Seller', 'New Arrival', 'Organic'
  final String description;
  final String volume;
  final bool inStock;
  final List<String> highlights;

  const ProductModel({
    required this.id,
    required this.name,
    required this.price,
    this.compareAtPrice,
    this.rating = 0,
    this.reviewCount = 0,
    required this.imageUrl,
    required this.category,
    this.badge,
    required this.description,
    this.volume = '',
    this.inStock = true,
    this.highlights = const [],
  });

  factory ProductModel.fromJson(Map<String, dynamic> json) {
    num? number(Object? value) {
      final parsed = value is num ? value : num.tryParse('$value');
      return parsed != null && parsed.isFinite ? parsed : null;
    }

    final highlights = json['highlights'];
    return ProductModel(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      price: number(json['price'])?.toInt() ?? 0,
      compareAtPrice:
          number(json['compare_at_price'] ?? json['compareAtPrice'])?.toInt(),
      rating: number(json['rating'])?.toDouble() ?? 0,
      reviewCount:
          number(json['review_count'] ?? json['reviewCount'])?.toInt() ?? 0,
      imageUrl: (json['image_url'] ?? json['imageUrl'])?.toString() ?? '',
      category: json['category']?.toString() ?? 'hair',
      badge: json['badge']?.toString(),
      description: json['description']?.toString() ?? '',
      volume: json['volume']?.toString() ?? '',
      inStock: (json['in_stock'] ?? json['inStock']) != false,
      highlights: highlights is List
          ? highlights.map((e) => e.toString()).toList()
          : const [],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'price': price,
      'compareAtPrice': compareAtPrice,
      'rating': rating,
      'reviewCount': reviewCount,
      'imageUrl': imageUrl,
      'category': category,
      'badge': badge,
      'description': description,
      'volume': volume,
      'inStock': inStock,
      'highlights': highlights,
    };
  }
}

class CartItem {
  final ProductModel product;
  int quantity;

  CartItem({
    required this.product,
    this.quantity = 1,
  });

  int get subtotal => product.price * quantity;

  Map<String, dynamic> toJson() => {
        'product': product.toJson(),
        'quantity': quantity,
      };

  factory CartItem.fromJson(Map<String, dynamic> json) => CartItem(
        product: ProductModel.fromJson(json['product'] as Map<String, dynamic>),
        quantity:
            (num.tryParse('${json['quantity']}')?.toInt() ?? 1).clamp(1, 100),
      );
}
