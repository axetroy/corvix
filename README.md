# Corvix

Corvix is a platform-independent, type-safe plugin runtime for TypeScript applications. It provides explicit plugin registration, dependency-aware activation, and lifecycle-managed resource cleanup.

The first implementation phase focuses on application and plugin lifecycle foundations. Hooks, events, and services will be added in later phases described in [`design.md`](./design.md).

## Requirements

- Node.js 18 or newer

## Install and verify

```sh
npm ci
npm run check
```

`npm run check` runs linting, production and test type checks, tests with coverage, and the TypeScript build.

## Quick start

```ts
import { CorvixApplication } from 'corvix';

const app = new CorvixApplication({ apiVersion: '0.1.0' });

app.register({
  manifest: {
    id: 'example.greeting',
    version: '1.0.0',
    apiVersion: '^0.1.0',
  },
  setup(context) {
    const timer = setInterval(() => console.log('Hello from Corvix'), 1000);
    context.disposables.add(() => clearInterval(timer));
  },
});

await app.start();
// When the host shuts down:
await app.stop();
```

Plugins must register every resource with their context so startup rollback and shutdown can release it. Plugin versions and API compatibility use SemVer 2.0 ranges. Plugin IDs are unique; required dependencies activate first, and compatible optional dependencies are ordered before their consumers.

See [`design.md`](./design.md) for the architecture, lifecycle guarantees, and implementation phases.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).
