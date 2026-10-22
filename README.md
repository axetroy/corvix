# Corvix

Corvix is a platform-independent, type-safe plugin runtime for TypeScript applications. It provides explicit plugin registration, dependency-aware activation, lifecycle-managed resources, Hooks, Events, and Services.

[简体中文](./README.zh-CN.md)

The initial runtime includes plugin lifecycle foundations and typed Hooks, Events, and Services, as described in [`design.md`](./design.md).

## Requirements

- Node.js 18 or newer

## Install and verify

```sh
npm ci
npm run check
```

`npm run check` runs linting, production and test type checks, tests with coverage, the TypeScript build, and an npm package dry run.

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

Plugins must register every resource with their context so startup rollback and shutdown can release it. Plugin versions and API compatibility use SemVer 2.0 ranges. Plugin IDs are unique; required dependencies activate first, and compatible optional dependencies are ordered before their consumers. Define event, hook, and service contracts in TypeScript, then supply hook execution modes and strategies when constructing the application. Each plugin registers owned hooks, listeners, and services through its context; these registrations are removed when it is deactivated.

Hook APIs support synchronous, async-series, and async-parallel execution, with series, waterfall, and bail strategies where applicable. Event delivery is synchronous and aggregates listener failures without stopping remaining listeners. Service access is type-safe and requires declaring the provider plugin in the manifest.

For example, give the application its contract maps and Hook runtime configuration:

```ts
interface AppEvents {
  'file:saved': { path: string; hash: string };
}

interface AppHooks {
  'workspace:beforeOpen': {
    args: { workspaceId: string };
    result: { reason: string };
    mode: 'AsyncSeries';
    strategy: 'bail';
  };
}

interface AppServices {
  file: { read(path: string): Promise<string> };
}

const app = new CorvixApplication<AppEvents, AppHooks, AppServices>({
  apiVersion: '0.1.0',
  hooks: {
    'workspace:beforeOpen': { mode: 'AsyncSeries', strategy: 'bail' },
  },
});
```

Within `setup(context)`, use `context.hooks.tap(...)`, `context.events.on(...)` / `emit(...)`, and `context.services.register(...)` / `get(...)` / `tryGet(...)`. Waterfall hooks take an initial value in `run`; bail handlers return `{ type: 'continue' }` or `{ type: 'bail', value }`.

If startup fails, `app.start()` can be called again to retry the full startup. `app.retryPlugin(id)` retries one failed plugin and its dependencies, then resumes startup; the application enters the running state only if all plugins activate successfully.

See [`design.md`](./design.md) for the architecture, lifecycle guarantees, and implementation phases.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).
