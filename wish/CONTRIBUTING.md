# Contributing to Wish

Thank you for your interest in contributing to Wish! This document provides guidelines and information for contributors.

## Philosophy

Wish is built on these principles:

1. **Lightweight** - Keep the API surface small and dependencies minimal
2. **Type-safe** - Full TypeScript support with excellent inference
3. **Composable** - Build complex operations from simple primitives
4. **Structured** - Structured concurrency ensures resources are cleaned up
5. **Portable** - Easy to copy into projects, no complex build setup
6. **Standard** - Built on web standards (AbortSignal, Promises)

When contributing, please keep these principles in mind.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/wish-concurrency.git
cd wish-concurrency

# Install dependencies
npm install

# Build the project
npm run build

# Run examples
npm run example:basic
npm run example:refactored
npm run example:advanced
```

## Project Structure

```
wish/
├── src/
│   ├── core.ts       # Core types: Wish, Fiber, Scope
│   ├── wish.ts       # Main API functions
│   ├── stream.ts     # Stream utilities for async iterables
│   └── index.ts      # Public exports
├── examples/
│   ├── basic.ts      # Basic usage examples
│   ├── refactored.ts # Original code refactored with Wish
│   ├── quick-start.ts # Quick start guide
│   └── advanced.ts   # Advanced patterns
├── dist/             # Compiled output (generated)
└── README.md         # Main documentation
```

## Adding New Features

Before adding a new feature, consider:

1. **Is it essential?** - Wish aims to be lightweight. Does this feature solve a common problem that can't be easily solved with existing primitives?

2. **Is it composable?** - Can it be built from existing primitives? If so, consider making it an example pattern rather than a core feature.

3. **Is it type-safe?** - Ensure full TypeScript support with proper inference.

4. **Does it follow standards?** - Prefer web standards (AbortSignal, Promises) over custom abstractions.

### Feature Proposal Template

When proposing a new feature, please include:

- **Use case**: What problem does this solve?
- **Example**: Show code before/after
- **Alternatives**: Can this be done with existing primitives?
- **API design**: What would the function signature be?

## Code Style

- Use TypeScript strict mode
- Prefer functional style over OOP
- Write clear, self-documenting code
- Add JSDoc comments for public APIs
- Keep functions small and focused

### Example

```typescript
/**
 * Transform the result of a Wish.
 *
 * @param wish - The wish to transform
 * @param fn - The transformation function
 * @returns A new wish with the transformed result
 */
export const map = <A, B>(wish: Wish<A>, fn: (a: A) => B): Wish<B> => {
  return async (signal) => {
    const result = await wish(signal);
    return fn(result);
  };
};
```

## Testing

Currently, Wish uses example-based testing (the files in `examples/`). When adding features:

1. Add examples demonstrating the feature
2. Ensure examples run without errors
3. Add edge cases (cancellation, errors, etc.)

Future: We'll add a proper test suite using a lightweight test runner.

## Documentation

When adding features, please update:

1. **README.md** - Add to API reference
2. **Examples** - Add usage examples
3. **COMPARISON.md** - If it simplifies a common pattern, add a before/after

## Pull Request Process

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Make** your changes
4. **Test** your changes (`npm run build && npm run example:basic`)
5. **Commit** with clear messages
6. **Push** to your fork
7. **Open** a Pull Request

### PR Checklist

- [ ] Code builds without errors
- [ ] Examples run successfully
- [ ] Documentation updated
- [ ] Types are correct and infer properly
- [ ] No breaking changes (or clearly documented)

## Release Process

(For maintainers)

1. Update version in `package.json`
2. Update CHANGELOG.md
3. Create git tag
4. Push to npm

```bash
npm version patch|minor|major
npm publish
git push --tags
```

## Questions?

Open an issue! We're happy to discuss ideas and help new contributors.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
