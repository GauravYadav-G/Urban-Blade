# Urban Blade — AI Engineering Guidelines (AGENTS.md)
> Based on the industry best practices from [liyupi/ai-guide](https://github.com/liyupi/ai-guide)

All AI agents and developers working on this project must adhere to the following standards:

## 1. Code Quality Standard ([01-code-quality.md](.agents/rules/01-code-quality.md))
- **Readability & Formatting**: Follow TypeScript strict typing, camelCase variables, PascalCase types.
- **Anti-Duplication**: Do not duplicate business logic or styles across components. Use `@core/services` and `src/styles/`.
- **Defensive Boundaries**: Always handle `null`, `undefined`, and empty lists. Validate all API payloads using Zod schemas.
- **Error Trapping**: Wrap async calls in `try/catch` and provide actionable user error messages.

## 2. Security Standard ([02-security-protection.md](.agents/rules/02-security-protection.md))
- **Zero Secrets in Code**: API keys, DB credentials, and JWT secrets must be loaded from `.env` and never committed or exposed in client bundles.
- **Backend Proxying**: Third-party APIs (payment gateways, AI services, notifications) must only be called from authenticated server routes.
- **SQL Injection Prevention**: Parameterize every SQL query using `$1, $2, ...` placeholders.
- **RBAC Enforcement**: All admin routes require valid JWT tokens. Multi-tenant vendor users are strictly isolated from Master Admin controls.

## 3. Performance Standard ([03-performance-optimization.md](.agents/rules/03-performance-optimization.md))
- **Caching**: Utilize in-memory LRU cache + Redis L2 cache with automatic fallback.
- **Bundle Budgets**: Comply with stylesheet and JS chunk budgets in `angular.json`.
- **System Telemetry**: Keep Node.js event loop lag under 100ms and monitor memory usage.

## 4. UI/UX Excellence ([04-ui-ux-design.md](.agents/rules/04-ui-ux-design.md))
- **De-AI Design**: Avoid generic neon purple-blue gradients or emoji-spam.
- **Brand Palette**: Maintain Urban Blade's bespoke palette (Obsidian `#0b0f19`, Champagne Amber `#f59e0b`, and Muted Slate `#64748b`).

## 5. Team Workflow & Verification ([05-team-workflow.md](.agents/rules/05-team-workflow.md))
- **Automated Verification**: Run `npm run test:guidelines` and `npm run test:admin` before finalizing features.
- **Commit Discipline**: Follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `perf:`).
- **Teardown Cleanliness**: Always clean up mock or temporary data during test teardowns.

## 6. Mobile Engineering Standard ([06-mobile-engineering.md](.agents/rules/06-mobile-engineering.md))
- **Widget Rebuilds & Const**: Eliminate unnecessary rebuilds, enforce `const` constructors on all static widgets, and scope state mutations tightly.
- **Layout Efficiency**: Avoid redundant `LayoutBuilder` passes, virtualize lists, and memoize expensive data operations outside `build()`.
- **Zero UI Alterations**: All architectural and performance optimizations must preserve pixel-perfect visual styling, layout, theme tokens, and user interactions.

