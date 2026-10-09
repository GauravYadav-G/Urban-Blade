# Security & Access Control Guidelines
> Extracted and adapted from liyupi/ai-guide (Vibe Coding Security Protection Techniques)

## 1. Secrets & Environment Variables Isolation
- **NEVER hardcode secrets**: API keys (Razorpay, OpenAI, Gemini), database connection strings (`DATABASE_URL`), and JWT secrets (`JWT_SECRET`) must NEVER be embedded in source code.
- **Strict Frontend Boundary**:
  - The client-side (Angular browser bundle) is public. Never place sensitive API keys or database credentials in client code.
  - Third-party AI, payment, or database interactions MUST be proxied through the authenticated backend API.
- **Git Hygiene**:
  - `.env`, `.env.local`, `.env.*.local` must remain strictly in `.gitignore`.
  - Maintain a clean, sanitized `.env.example` with documentation on required keys for team setup.

## 2. Injection Defense
- **SQL Injection**:
  - Always use parameterized queries (e.g. `$1, $2` in `pg` pool queries).
  - NEVER concatenate user-controlled strings directly into SQL queries.
- **XSS (Cross-Site Scripting)**:
  - Do not use unsafe innerHTML rendering without sanitization. Rely on Angular's built-in contextual encoding.

## 3. OWASP Access Control (RBAC) & Rate Limiting
- **Authentication Guard**: Unauthenticated requests to private resources must be rejected immediately with `401 Unauthorized`.
- **Role Isolation**:
  - Customer roles must not access administrative endpoints (`403 Forbidden`).
  - Multi-tenant Vendor roles must be restricted from Master Admin controls (such as system maintenance, cache flushing, global customer PII, and other vendors' accounts).
- **High-Concurrency Rate Limiting**:
  - Sensitive routes (e.g. `/api/auth/login`, `/api/admin/vendors/login`, payment creation) must have rate limiting enabled to prevent brute-force and credential stuffing.
