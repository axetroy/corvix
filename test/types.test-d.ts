import { CorvixApplication } from '../src/index.js';
import type {
  HookRuntimeConfiguration,
} from '../src/index.js';

interface Events {
  'file:saved': { path: string; hash: string };
}

interface Hooks {
  'workspace:open': {
    args: { workspaceId: string };
    result: { allowed: boolean };
    mode: 'AsyncSeries';
    strategy: 'bail';
  };
  'task:notify': {
    args: { taskId: string };
    mode: 'Sync';
    strategy: 'series';
  };
}

interface Services {
  file: { read(path: string): Promise<string> };
}

const hooks = {
  'workspace:open': { mode: 'AsyncSeries', strategy: 'bail' },
  'task:notify': { mode: 'Sync', strategy: 'series' },
} satisfies HookRuntimeConfiguration<Hooks>;

const app = new CorvixApplication<Events, Hooks, Services>({
  apiVersion: '0.1.0',
  hooks,
});

// @ts-expect-error Hook contracts require runtime mode/strategy configuration
new CorvixApplication<Events, Hooks, Services>({ apiVersion: '0.1.0' });
app.register({
  manifest: {
    id: 'typed.plugin',
    version: '1.0.0',
    apiVersion: '^0.1.0',
  },
  setup(context) {
    const pluginId: string = context.pluginId;
    context.disposables.add(() => { void pluginId; });
    context.events.on('file:saved', (payload) => {
      const hash: string = payload.hash;
      void hash;
    });
    context.events.emit('file:saved', { path: '/tmp/a', hash: 'abc' });

    // @ts-expect-error Event listeners must be synchronous
    context.events.on('file:saved', async () => {});
    const maybeAsyncListener = (): void | Promise<void> => {};
    // @ts-expect-error Potentially async listeners are not supported
    context.events.on('file:saved', maybeAsyncListener);

    context.hooks.tap('workspace:open', ({ workspaceId }) => ({
      type: 'bail',
      value: { allowed: workspaceId.length > 0 },
    }));

    // @ts-expect-error Sync hook handlers cannot return a Promise
    context.hooks.tap('task:notify', async () => {});
    const maybeAsyncHook = (): void | Promise<void> => {};
    // @ts-expect-error Potentially async Sync hook handlers are not supported
    context.hooks.tap('task:notify', maybeAsyncHook);
    const file = context.services.get('file');
    void file.read('/tmp/a');

    // @ts-expect-error Unknown event name
    context.events.emit('file:deleted', {});

    // @ts-expect-error Event payload is missing hash
    context.events.emit('file:saved', { path: '/tmp/a' });

    // @ts-expect-error Unknown hook name
    context.hooks.tap('workspace:close', () => ({ type: 'continue' }));

    // @ts-expect-error Handler parameters must match the hook contract
    context.hooks.tap('workspace:open', (_args: { invalid: number }) => {
      void _args;
      return { type: 'continue' };
    });

    // @ts-expect-error Unknown service name
    context.services.get('database');

    // @ts-expect-error Service implementation must match its contract
    context.services.register('file', { read: async () => 1 });
  },
});

// @ts-expect-error API version must be a string
new CorvixApplication({ apiVersion: 1 });

// @ts-expect-error Plugin setup is required
app.register({ manifest: { id: 'invalid', version: '1.0.0', apiVersion: '^0.1.0' } });
