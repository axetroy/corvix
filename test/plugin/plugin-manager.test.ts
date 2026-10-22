import { describe, expect, it } from 'vitest';
import {
  ApplicationStartError,
  CorvixApplication,
  PluginActivationError,
  PluginDependencyError,
  PluginRegistrationError,
} from '../../src/index.js';
import type { PluginDefinition } from '../../src/index.js';

function createPlugin(
  id: string,
  setup: PluginDefinition['setup'] = () => {},
  options: {
    version?: string;
    apiVersion?: string;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    deactivate?: PluginDefinition['deactivate'];
  } = {},
): PluginDefinition {
  return {
    manifest: {
      id,
      version: options.version ?? '1.0.0',
      apiVersion: options.apiVersion ?? '^0.1.0',
      ...(options.dependencies === undefined
        ? {}
        : { dependencies: options.dependencies }),
      ...(options.optionalDependencies === undefined
        ? {}
        : { optionalDependencies: options.optionalDependencies }),
    },
    setup,
    ...(options.deactivate === undefined
      ? {}
      : { deactivate: options.deactivate }),
  };
}

describe('plugin lifecycle', () => {
  it('activates dependencies first and deactivates in reverse order', async () => {
    const calls: string[] = [];
    const app = new CorvixApplication({ apiVersion: '0.1.2' });
    app.register(createPlugin(
      'consumer',
      (context) => {
        calls.push('setup consumer');
        context.disposables.add(() => { calls.push('dispose consumer'); });
      },
      {
        dependencies: { provider: '^1.0.0' },
        deactivate: () => { calls.push('deactivate consumer'); },
      },
    ));
    app.register(createPlugin(
      'provider',
      (context) => {
        calls.push('setup provider');
        context.disposables.add(() => { calls.push('dispose provider'); });
      },
      { deactivate: () => { calls.push('deactivate provider'); } },
    ));

    await app.start();
    expect(app.state).toBe('running');
    expect(calls).toEqual(['setup provider', 'setup consumer']);

    await app.stop();
    expect(app.state).toBe('stopped');
    expect(calls).toEqual([
      'setup provider',
      'setup consumer',
      'deactivate consumer',
      'dispose consumer',
      'deactivate provider',
      'dispose provider',
    ]);
  });

  it('uses compatible optional dependencies but ignores unavailable ones', async () => {
    const calls: string[] = [];
    const app = new CorvixApplication({ apiVersion: '0.1.0' });
    app.register(createPlugin(
      'consumer',
      () => { calls.push('consumer'); },
      {
        optionalDependencies: {
          available: '^1.0.0',
          incompatible: '^2.0.0',
          missing: '^1.0.0',
        },
      },
    ));
    app.register(createPlugin('available', () => { calls.push('available'); }));
    app.register(createPlugin('incompatible', () => { calls.push('incompatible'); }));

    await app.start();

    expect(calls).toEqual(['available', 'consumer', 'incompatible']);
    await app.stop();
  });

  it('fails required missing, incompatible, and cyclic dependencies', async () => {
    const missing = new CorvixApplication({ apiVersion: '0.1.0' });
    missing.register(createPlugin('consumer', () => {}, {
      dependencies: { absent: '^1.0.0' },
    }));
    const startupError = await missing.start().then(
      () => { throw new Error('Expected startup to fail'); },
      (error: unknown) => error,
    );
    expect(startupError).toBeInstanceOf(ApplicationStartError);
    expect(startupError).toMatchObject({
      cause: expect.any(PluginDependencyError),
      rollbackErrors: [],
    });
    expect(missing.getPluginState('consumer')).toBe('failed');

    const incompatible = new CorvixApplication({ apiVersion: '0.1.0' });
    incompatible.register(createPlugin('consumer', () => {}, {
      dependencies: { provider: '^2.0.0' },
    }));
    incompatible.register(createPlugin('provider', () => {}, { version: '1.0.0' }));
    await expect(incompatible.start()).rejects.toMatchObject({
      cause: expect.any(PluginDependencyError),
    });

    const cyclic = new CorvixApplication({ apiVersion: '0.1.0' });
    cyclic.register(createPlugin('first', () => {}, {
      dependencies: { second: '^1.0.0' },
    }));
    cyclic.register(createPlugin('second', () => {}, {
      dependencies: { first: '^1.0.0' },
    }));
    await expect(cyclic.start()).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/dependency cycle/i) }),
    });
  });

  it('validates registration metadata and API compatibility', async () => {
    const app = new CorvixApplication({ apiVersion: '0.1.0' });
    expect(() => app.register(createPlugin('invalid id'))).toThrow(
      PluginRegistrationError,
    );
    expect(() => app.register(createPlugin('bad-range', () => {}, {
      dependencies: { provider: 'not a range' },
    }))).toThrow(PluginRegistrationError);

    app.register(createPlugin('incompatible-api', () => {}, {
      apiVersion: '^1.0.0',
    }));
    await expect(app.start()).rejects.toMatchObject({
      cause: expect.any(PluginDependencyError),
    });
  });

  it('rolls back failed activation and explicitly retries with a fresh context', async () => {
    const calls: string[] = [];
    const contexts: object[] = [];
    let failFirstAttempt = true;
    const app = new CorvixApplication({ apiVersion: '0.1.0' });
    app.register(createPlugin('provider', (context) => {
      contexts.push(context);
      calls.push('setup provider');
      context.disposables.add(() => { calls.push('dispose provider'); });
    }));
    app.register(createPlugin(
      'consumer',
      (context) => {
        contexts.push(context);
        calls.push('setup consumer');
        context.disposables.add(() => { calls.push('dispose consumer'); });
        if (failFirstAttempt) {
          failFirstAttempt = false;
          throw new Error('setup failed');
        }
      },
      { dependencies: { provider: '^1.0.0' } },
    ));

    await expect(app.start()).rejects.toMatchObject({
      cause: expect.any(PluginActivationError),
    });
    expect(app.state).toBe('stopped');
    expect(app.getPluginState('provider')).toBe('inactive');
    expect(app.getPluginState('consumer')).toBe('failed');
    expect(calls).toEqual([
      'setup provider',
      'setup consumer',
      'dispose consumer',
      'dispose provider',
    ]);

    await app.retryPlugin('consumer');
    expect(app.getPluginState('provider')).toBe('active');
    expect(app.getPluginState('consumer')).toBe('active');
    expect(app.state).toBe('running');
    expect(contexts[0]).not.toBe(contexts[2]);
    expect(contexts[1]).not.toBe(contexts[3]);

    await app.stop();
    expect(app.state).toBe('stopped');
  });

  it('rolls back plugins activated by a retry if full startup later fails', async () => {
    let failConsumer = true;
    const app = new CorvixApplication({ apiVersion: '0.1.0' });
    app.register(createPlugin('provider'));
    app.register(createPlugin(
      'consumer',
      () => {
        if (failConsumer) {
          failConsumer = false;
          throw new Error('first attempt failed');
        }
      },
      { dependencies: { provider: '^1.0.0' } },
    ));
    app.register(createPlugin('late-failure', () => {
      throw new Error('later startup failure');
    }));

    await expect(app.start()).rejects.toMatchObject({
      cause: expect.any(PluginActivationError),
    });
    await expect(app.retryPlugin('consumer')).rejects.toMatchObject({
      cause: expect.any(PluginActivationError),
    });
    expect(app.state).toBe('stopped');
    expect(app.getPluginState('provider')).toBe('inactive');
    expect(app.getPluginState('consumer')).toBe('inactive');
    expect(app.getPluginState('late-failure')).toBe('failed');
  });

  it('cleans all plugins after deactivation failures', async () => {
    const calls: string[] = [];
    const app = new CorvixApplication({ apiVersion: '0.1.0' });
    app.register(createPlugin(
      'first',
      (context) => {
        context.disposables.add(() => { calls.push('first cleanup'); });
        context.disposables.add(() => {
          calls.push('first failing cleanup');
          throw new Error('first cleanup failed');
        });
      },
      { deactivate: () => { throw new Error('deactivation failed'); } },
    ));
    app.register(createPlugin('second', (context) => {
      context.disposables.add(() => { calls.push('second cleanup'); });
    }));
    await app.start();

    await expect(app.stop()).rejects.toMatchObject({
      errors: [expect.objectContaining({ pluginId: 'first' })],
    });
    expect(calls).toEqual([
      'second cleanup',
      'first failing cleanup',
      'first cleanup',
    ]);
    expect(app.getPluginState('first')).toBe('inactive');
    expect(app.getPluginState('second')).toBe('inactive');
    expect(app.state).toBe('stopped');
  });

  it('coalesces repeated lifecycle calls and serializes stop after start', async () => {
    let finishSetup: (() => void) | undefined;
    const calls: string[] = [];
    const app = new CorvixApplication({ apiVersion: '0.1.0' });
    app.register(createPlugin(
      'slow',
      async () => {
        calls.push('setup');
        await new Promise<void>((resolve) => {
          finishSetup = resolve;
        });
      },
      { deactivate: () => { calls.push('deactivate'); } },
    ));

    const firstStart = app.start();
    expect(app.start()).toBe(firstStart);
    const stop = app.stop();
    await Promise.resolve();
    finishSetup?.();

    await Promise.all([firstStart, stop]);
    expect(calls).toEqual(['setup', 'deactivate']);
    expect(app.state).toBe('stopped');
  });

  it('logs plugin errors with context without allowing logger failures to mask them', async () => {
    const records: { message: string; context: unknown }[] = [];
    const app = new CorvixApplication({
      apiVersion: '0.1.0',
      logger: {
        debug() {},
        info() {},
        warn() {},
        error(message, context) {
          records.push({ message, context });
          if (message === 'Plugin deactivation failed') {
            throw new Error('logger failed');
          }
        },
      },
    });
    app.register(createPlugin(
      'logged',
      () => { throw new Error('setup failed'); },
      { version: '1.0.0' },
    ));

    await expect(app.start()).rejects.toMatchObject({
      cause: expect.objectContaining({
        pluginId: 'logged',
        cause: expect.objectContaining({ message: 'setup failed' }),
      }),
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      message: 'Plugin activation failed',
      context: { pluginId: 'logged', phase: 'activation' },
    });
  });

  it('retains rollback errors alongside the startup failure', async () => {
    const app = new CorvixApplication({ apiVersion: '0.1.0' });
    app.register(createPlugin(
      'provider',
      () => {},
      { deactivate: () => { throw new Error('provider cleanup failed'); } },
    ));
    app.register(createPlugin('consumer', () => {
      throw new Error('consumer setup failed');
    }, { dependencies: { provider: '^1.0.0' } }));

    const startupError = await app.start().then(
      () => { throw new Error('Expected startup to fail'); },
      (error: unknown) => error,
    );
    expect(startupError).toBeInstanceOf(ApplicationStartError);
    expect(startupError).toMatchObject({
      cause: expect.any(PluginActivationError),
      rollbackErrors: [
        expect.objectContaining({ pluginId: 'provider' }),
      ],
    });
    expect(app.getPluginState('provider')).toBe('inactive');
  });

  it('contains logger exceptions during plugin deactivation', async () => {
    const app = new CorvixApplication({
      apiVersion: '0.1.0',
      logger: {
        debug() {},
        info() {},
        warn() {},
        error() { throw new Error('logger failed'); },
      },
    });
    app.register(createPlugin(
      'logged-shutdown',
      () => {},
      { deactivate: () => { throw new Error('deactivation failed'); } },
    ));

    await app.start();
    await expect(app.stop()).rejects.toMatchObject({
      errors: [expect.objectContaining({
        pluginId: 'logged-shutdown',
        errors: [expect.objectContaining({ message: 'deactivation failed' })],
      })],
    });
    expect(app.getPluginState('logged-shutdown')).toBe('inactive');
  });
});
