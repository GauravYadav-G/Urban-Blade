---
name: ai-guide
description: >-
  Vibe Coding and Engineering Quality Guidelines based on liyupi/ai-guide.
  Provides automated rules, best practices, and verification checklists for code
  quality, security protection (zero secrets in frontend, parameterized SQL, RBAC
  access control), performance optimization (L1/L2 caching, bundle control), UI/UX
  design polish (de-AI styling), and development workflow standards. Trigger whenever
  reviewing code quality, auditing security, optimizing performance, or ensuring
  production readiness.
metadata:
  source: https://github.com/liyupi/ai-guide
---

# AI Guide (Vibe Coding & Engineering Standards)

This skill encapsulates the production-grade engineering principles from [liyupi/ai-guide](https://github.com/liyupi/ai-guide).

## 1. Five Core Pillars
1. **Code Quality**:
   - High readability, strong maintainability, single-responsibility services.
   - Comprehensive boundary condition handling (nulls, empty collections, type mismatches).
   - DRY (Don't Repeat Yourself): Shared logic centralized into core modules.
2. **Security & Access Control**:
   - Zero hardcoded secrets: All credentials stored in `.env`.
   - Never expose API keys or backend connections in client-side bundles.
   - Parameterized queries to eliminate SQL injection risks.
   - Strict RBAC: Unauthenticated requests return 401; unauthorized roles return 403.
3. **Performance Optimization**:
   - Multi-tier caching: In-memory L1 cache + Redis L2 cache.
   - Lean bundles: Comply with Angular/Vite component budget limits.
   - Database queries indexed and monitored with telemetry.
4. **UI/UX Polish**:
   - Refined, brand-specific color palette (no generic purple gradients).
   - Crisp typography, responsive views, meaningful micro-interactions.
5. **Team Workflow**:
   - Pre-dev design review, conventional commit messages.
   - Automated self-testing before merge / deployment.

## 2. Verification Command
To verify compliance across all guidelines in this codebase, run:
```bash
npm run test:guidelines
```
