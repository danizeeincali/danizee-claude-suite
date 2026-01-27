# Operational Commands

> Customize these commands for your project's tooling.

## Build Commands

```bash
# Compile/transpile the project
npm run build
```

## Test Commands

```bash
# Run all tests
npm test

# Run specific test file
npm test -- --grep "feature-name"

# Run with coverage
npm run test:coverage
```

## Lint Commands

```bash
# Run linter
npm run lint

# Auto-fix lint issues
npm run lint:fix
```

## Type Check

```bash
# TypeScript type checking
npm run typecheck

# Or if using tsc directly
npx tsc --noEmit
```

## Validation Sequence

**Run these in order after EVERY change:**

1. **Type check** - Catch type errors early
   ```bash
   npm run typecheck
   ```

2. **Lint** - Ensure code style
   ```bash
   npm run lint
   ```

3. **Test** - Verify functionality
   ```bash
   npm test
   ```

4. **Build** - Confirm production build works
   ```bash
   npm run build
   ```

## Backpressure Rules

- **ALL commands must pass** before marking a task complete
- If any command fails, fix the issue BEFORE proceeding
- Commit only after validation passes
- Never skip validation "to save time"

## Project-Specific Commands

<!-- Add your project's custom commands here -->

```bash
# Example: Database migrations
# npm run db:migrate

# Example: Generate API docs
# npm run docs:generate

# Example: E2E tests
# npm run test:e2e
```

## Commit Verification

Before committing:
```bash
# Ensure clean working state after validation
git status
git diff --stat
```

After committing:
```bash
# Verify commit succeeded
git log -1 --oneline
```
