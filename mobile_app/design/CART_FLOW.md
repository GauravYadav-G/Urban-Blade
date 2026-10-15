# Cart interaction — 1.8.0 (11)

Reference: `cart.mov` in the workspace root.

The Flutter shop now sits above a black cart dock with circular product previews and a yellow quantity badge. Adding from a product card sends a product thumbnail along a curved path into the dock; the previews and badge animate as cart quantities change. Tapping the dock or swiping upward slides the rounded collection surface out of the way and reveals the dark cart. The bottom navigation collapses during the transition. The top handle, Continue shopping, and system Back return to the retained collection.

Adding from product details returns to the collection with the updated dock. The product-detail cart action and the shared header open the same cart flow. Buy now keeps the existing checkout action.

Existing catalog, INR pricing, sign-in, cart synchronization, promotion controls, payment locks, quantity limits, removal/undo, and checkout remain connected to AppState. The reference's grocery items, delivery prices, and currency are not copied. Reduced-motion settings skip the explicit animations. Short landscape views scroll the summary with the contents; portrait keeps checkout at the bottom.

Key implementation files:
- `lib/features/cart/cart_flow.dart`: dock, flight animation, reveal, swipe and Back handling.
- `lib/features/cart/cart_screen.dart`: dark appearance and responsive cart contents.
- `lib/features/shop/shop_screen.dart`: retained collection and add origins.
- `lib/features/main_shell.dart`: shared navigation and product-detail handoff.

Visual previews: `test/goldens/cart-dock.png`, `cart-expanded.png`, and `cart.png`.
Regression coverage includes rapid additions, quantity/subtotal changes, swipe opening, system Back, detail handoff, checkout callbacks, reduced motion, large text, and landscape scrolling. Actual payment completion and on-device frame timing require device validation.

Validation: `flutter analyze` reports no issues; all 41 Flutter tests pass. Screenshots were rendered and inspected. Android artifact: `UrbanBlade-CartFlow-1.8.0.apk` in the workspace root, using the project's existing signing configuration.
