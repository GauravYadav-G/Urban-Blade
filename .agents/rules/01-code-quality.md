# Code Quality & Maintainability Guidelines
> Extracted and adapted from liyupi/ai-guide (Vibe Coding Code Quality Assurance)

## Core Philosophy
1. **Readability First**: Code must be clear and self-documenting. Clear naming (camelCase for variables/functions, PascalCase for classes/types, UPPER_SNAKE_CASE for constants).
2. **High Maintainability**: Components and services must have a single responsibility. Avoid giant multi-thousand-line monolithic blocks when separable into sub-modules.
3. **Anti-Duplication (DRY)**: Never generate duplicate code across pages. If multiple views share identical tables, search filters, or forms, extract a reusable shared component or service.
4. **Boundary & Edge-Case Protection**:
   - Always validate inputs before processing (e.g., Zod schemas on backend, Reactive forms on frontend).
   - Explicitly handle null, undefined, empty lists, and missing properties.
   - Protect against division-by-zero, negative numbers, and out-of-range dates.
5. **Robust Error Handling**:
   - Always wrap risky asynchronous operations with `try/catch`.
   - Never leak raw internal stack traces or database schema errors to end users.
   - Provide human-readable, actionable error messages.
6. **Code Review & Verification**:
   - Verify TypeScript compilation without errors (`tsc --noEmit`).
   - Run linter and formatting before finalizing edits.
   - Read changed diffs thoroughly before committing.
