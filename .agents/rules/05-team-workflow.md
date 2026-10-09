# Team R&D & Verification Workflow Guidelines
> Extracted and adapted from liyupi/ai-guide (Team R&D Standards & Conventional Practices)

## 1. Development Lifecycle Discipline
1. **Understand Before Coding**: Never jump into code changes without understanding existing architecture and user requirements.
2. **Reuse Existing Utilities**: Before adding a new helper or dependency, check existing services (`src/app/core/services/` and `server/src/core/`).
3. **Clean Git Branching & Commits**:
   - Use conventional commit messages: `feat:`, `fix:`, `refactor:`, `test:`, `perf:`, `docs:`.
   - Never commit sensitive `.env` files or compiled binaries.

## 2. Automated Self-Testing & Verification
- **Test Before Merging**:
  - Every bug fix or feature must be accompanied or validated by automated test execution.
  - Run `npm run test:admin` and `npm run build` to confirm 100% buildability and test passes.
- **Teardown Cleanliness**:
  - Test scripts must automatically clean up mock/test data in `finally` blocks so database states remain pristine.
