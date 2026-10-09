# Performance Optimization & Telemetry Guidelines
> Extracted and adapted from liyupi/ai-guide (Vibe Coding Performance Optimization)

## 1. Multi-Tier Caching Architecture
- **L1 In-Memory Fast Cache**: High-speed LRU memory cache for hot entities (site settings, catalog metadata) with short TTL (60s).
- **L2 Redis Cache**: Shared cluster caching for distributed nodes, with automatic fallback to high-speed in-memory cache when Redis is unavailable in local dev.
- **Cache Invalidation**: Mutation operations (creating/updating/deleting products, orders, coupons) must trigger immediate cache invalidation.

## 2. Resource Budgeting & Bundle Control
- **Stylesheet & Script Budgets**:
  - Keep component SCSS and templates lean. Do not exceed bundle size budgets configured in `angular.json`.
  - Share global design system variables and mixins via `src/styles/` rather than duplicating CSS rules across components.
- **Lazy Loading**:
  - Large admin modules and checkout flows must be lazy-loaded using Angular's standalone route `loadComponent` / `loadChildren`.

## 3. Database & Network Efficiency
- **Indexed Queries**: Index foreign keys (`user_id`, `order_id`) and search query fields (`slug`, `email`, `created_at`).
- **Lean Payloads**: Return only required fields; avoid unnecessary heavy payload serialization over HTTP.
- **Load Shedding & Health Checks**:
  - Monitor Node.js event loop lag and RSS memory consumption (`/api/admin/system`).
  - Implement load-shedding circuit breakers when event loop delay exceeds safe thresholds.
