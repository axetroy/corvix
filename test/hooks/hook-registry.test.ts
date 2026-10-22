import { describe, expect, it } from 'vitest';
import {
  CorvixApplication,
  HookExecutionError,
  HookRegistrationError,
} from '../../src/index.js';
import type {
  HookHandler,
  HookRuntimeConfiguration,
  PluginDefinition,
} from '../../src/index.js';

interface AppHooks {
  'task:notify': {
    args: { taskId: string };
    mode: 'Sync';
    strategy: 'series';
  };
  'task:authorize': {
    args: { taskId: string };
    result: { reason: string };
    mode: 'AsyncSeries';
    strategy: 'bail';
  };
  'task:transform': {
    args: { taskId: string };
    result: string;
    mode: 'AsyncSeries';
    strategy: 'waterfall';
  };
  'task:parallel': {
    args: { taskId: string };
    mode: 'AsyncParallel';
    strategy: 'series';
  };
}

const hooks = {
  'task:notify': { mode: 'Sync', strategy: 'series' },
  'task:authorize': { mode: 'AsyncSeries', strategy: 'bail' },
  'task:transform': { mode: 'AsyncSeries', strategy: 'waterfall' },
  'task:parallel': { mode: 'AsyncParallel', strategy: 'series' },
} satisfies HookRuntimeConfiguration<AppHooks>;

function plugin(
  id: string,
  setup: PluginDefinition<Record<never, never>, AppHooks, Record<never, never>>['setup'],
): PluginDefinition<Record<never, never>, AppHooks, Record<never, never>> {
  return {
    manifest: { id, version: '1.0.0', apiVersion: '^0.1.0' },
    setup,
  };
}

describe('typed Hook API', () => {
  it('respects before constraints, then priority and stable registration order', async () => {
    const calls: string[] = [];
    let run!: (taskId: string) => void;
    const app = new CorvixApplication<Record<never, never>, AppHooks, Record<never, never>>({
      apiVersion: '0.1.0',
      hooks,
    });
    app.register(plugin('first', (context) => {
      run = (taskId) => context.hooks.run('task:notify', { taskId });
      context.hooks.tap('task:notify', () => { calls.push('first'); });
      context.hooks.tap(
        'task:notify',
        () => { calls.push('priority'); },
        { priority: 10 },
      );
    }));
    app.register(plugin('second', (context) => {
      context.hooks.tap(
        'task:notify',
        () => { calls.push('after'); },
        { before: 'first' },
      );
    }));

    await app.start();
    run('task-1');
    expect(calls).toEqual(['after', 'priority', 'first']);
    await app.stop();
  });

  it('rejects Promise-returning Sync handlers at runtime', async () => {
    let run!: () => void;
    const app = new CorvixApplication<
      Record<never, never>,
      AppHooks,
      Record<never, never>
    >({ apiVersion: '0.1.0', hooks });
    app.register(plugin('sync-plugin', (context) => {
      run = () => context.hooks.run('task:notify', { taskId: 'x' });
      context.hooks.tap(
        'task:notify',
        (() => Promise.resolve()) as unknown as HookHandler<AppHooks['task:notify']>,
      );
    }));

    await app.start();
    expect(run).toThrow(HookExecutionError);
    await app.stop();
  });

  it('allows the host to invoke hooks only while the application is running', async () => {
    const calls: string[] = [];
    const app = new CorvixApplication<
      Record<never, never>,
      AppHooks,
      Record<never, never>
    >({ apiVersion: '0.1.0', hooks });
    app.register(plugin('listener', (context) => {
      context.hooks.tap('task:notify', ({ taskId }) => { calls.push(taskId); });
    }));

    expect(() => app.hooks.run('task:notify', { taskId: 'before' })).toThrow(
      /unavailable while stopped/,
    );
    await app.start();
    app.hooks.run('task:notify', { taskId: 'from-host' });
    expect(calls).toEqual(['from-host']);
    await app.stop();
    expect(() => app.hooks.run('task:notify', { taskId: 'after' })).toThrow(
      /unavailable while stopped/,
    );
  });

  it('supports waterfall transformation and explicit bail outcomes', async () => {
    const results: string[] = [];
    let transform!: (taskId: string) => Promise<string>;
    let authorize!: (
      taskId: string,
    ) => Promise<{ type: 'continue' } | { type: 'bail'; value: { reason: string } }>;
    const app = new CorvixApplication<Record<never, never>, AppHooks, Record<never, never>>({
      apiVersion: '0.1.0',
      hooks,
    });
    app.register(plugin('normalizer', (context) => {
      transform = (taskId) =>
        context.hooks.run('task:transform', { taskId }, 'start');
      authorize = (taskId) =>
        context.hooks.run('task:authorize', { taskId });
      context.hooks.tap('task:transform', async (_args, previous) => `${previous}:one`);
      context.hooks.tap('task:authorize', async () => ({ type: 'continue' }));
    }));
    app.register(plugin('finalizer', (context) => {
      context.hooks.tap('task:transform', (_args, previous) => `${previous}:two`);
      context.hooks.tap('task:authorize', () => ({
        type: 'bail',
        value: { reason: 'blocked' },
      }));
      context.hooks.tap('task:authorize', () => {
        results.push('must not run');
        return { type: 'continue' };
      });
    }));

    await app.start();
    expect(await transform('task-1')).toBe('start:one:two');
    expect(await authorize('task-1')).toEqual({
      type: 'bail',
      value: { reason: 'blocked' },
    });
    expect(results).toEqual([]);
    await app.stop();
  });

  it('waits for all parallel handlers and aggregates contextual errors', async () => {
    const calls: string[] = [];
    let run!: () => Promise<void>;
    const app = new CorvixApplication<Record<never, never>, AppHooks, Record<never, never>>({
      apiVersion: '0.1.0',
      hooks,
    });
    app.register(plugin('parallel-one', (context) => {
      run = () => context.hooks.run('task:parallel', { taskId: 'x' });
      context.hooks.tap('task:parallel', async () => {
        await Promise.resolve();
        calls.push('one');
        throw new Error('one failed');
      });
    }));
    app.register(plugin('parallel-two', (context) => {
      context.hooks.tap('task:parallel', async () => {
        calls.push('two');
        throw new Error('two failed');
      });
    }));

    await app.start();
    await expect(run()).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ pluginId: 'parallel-one' }),
        expect.objectContaining({ pluginId: 'parallel-two' }),
      ],
    });
    expect(calls.sort()).toEqual(['one', 'two']);
    await app.stop();
  });

  it('wraps serial failures with hook and plugin context', async () => {
    let run!: () => void;
    const app = new CorvixApplication<Record<never, never>, AppHooks, Record<never, never>>({
      apiVersion: '0.1.0',
      hooks,
    });
    app.register(plugin('broken', (context) => {
      run = () => context.hooks.run('task:notify', { taskId: 'x' });
      context.hooks.tap('task:notify', () => {
        throw new Error('handler failed');
      });
    }));

    await app.start();
    expect(run).toThrow(HookExecutionError);
    try {
      run();
    } catch (error) {
      expect(error).toMatchObject({
        hookName: 'task:notify',
        pluginId: 'broken',
        cause: expect.objectContaining({ message: 'handler failed' }),
      });
    }
    await app.stop();
  });

  it('rejects ordering cycles and disposes taps with the plugin', async () => {
    let run!: () => void;
    const calls: string[] = [];
    const app = new CorvixApplication<Record<never, never>, AppHooks, Record<never, never>>({
      apiVersion: '0.1.0',
      hooks,
    });
    app.register(plugin('first', (context) => {
      run = () => context.hooks.run('task:notify', { taskId: 'x' });
      context.hooks.tap('task:notify', () => { calls.push('first'); }, {
        before: 'second',
      });
    }));
    app.register(plugin('second', (context) => {
      context.hooks.tap('task:notify', () => { calls.push('second'); }, {
        before: 'first',
      });
    }));

    await expect(app.start()).rejects.toMatchObject({
      cause: expect.any(HookRegistrationError),
    });
    expect(app.getPluginState('first')).toBe('inactive');
    expect(app.getPluginState('second')).toBe('failed');
    expect(run).toThrow(/cannot run hooks while inactive/);
    expect(calls).toEqual([]);
  });
});
