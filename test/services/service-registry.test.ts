import { describe, expect, it } from 'vitest';
import {
  CorvixApplication,
  DuplicateRegistrationError,
  ServiceNotFoundError,
} from '../../src/index.js';
import type { PluginDefinition } from '../../src/index.js';

interface AppServices {
  file: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
  };
}

function plugin(
  id: string,
  setup: PluginDefinition<Record<never, never>, Record<never, never>, AppServices>['setup'],
  dependencies?: Record<string, string>,
  optionalDependencies?: Record<string, string>,
): PluginDefinition<Record<never, never>, Record<never, never>, AppServices> {
  return {
    manifest: {
      id,
      version: '1.0.0',
      apiVersion: '^0.1.0',
      ...(dependencies ? { dependencies } : {}),
      ...(optionalDependencies ? { optionalDependencies } : {}),
    },
    setup,
  };
}

describe('typed Service API', () => {
  it('registers services and gates access on declared required dependencies', async () => {
    let read!: (path: string) => Promise<string>;
    const app = new CorvixApplication<Record<never, never>, Record<never, never>, AppServices>({
      apiVersion: '0.1.0',
    });
    app.register(plugin('file-provider', (context) => {
      context.services.register('file', {
        async read(path) { return `contents:${path}`; },
        async write() {},
      });
    }));
    app.register(plugin(
      'consumer',
      (context) => {
        const file = context.services.get('file');
        read = (path) => file.read(path);
      },
      { 'file-provider': '^1.0.0' },
    ));

    await app.start();
    await expect(read('/tmp/a')).resolves.toBe('contents:/tmp/a');
    await app.stop();
    expect(app.getPluginState('file-provider')).toBe('inactive');
  });

  it('permits optional lookup only through a declared optional dependency', async () => {
    let result: AppServices['file'] | undefined;
    const app = new CorvixApplication<Record<never, never>, Record<never, never>, AppServices>({
      apiVersion: '0.1.0',
    });
    app.register(plugin('provider', (context) => {
      context.services.register('file', {
        async read(path) { return path; },
        async write() {},
      });
    }));
    app.register(plugin(
      'optional-consumer',
      (context) => {
        result = context.services.tryGet('file');
      },
      undefined,
      { provider: '^1.0.0' },
    ));

    await app.start();
    expect(result).toBeDefined();
    await app.stop();
  });

  it('rejects missing dependency access and duplicate service registrations', async () => {
    const missingDependency = new CorvixApplication<Record<never, never>, Record<never, never>, AppServices>({
      apiVersion: '0.1.0',
    });
    missingDependency.register(plugin('provider', (context) => {
      context.services.register('file', {
        async read(path) { return path; },
        async write() {},
      });
    }));
    missingDependency.register(plugin('consumer', (context) => {
      context.services.get('file');
    }));
    await expect(missingDependency.start()).rejects.toMatchObject({
      cause: expect.any(ServiceNotFoundError),
    });

    const duplicate = new CorvixApplication<Record<never, never>, Record<never, never>, AppServices>({
      apiVersion: '0.1.0',
    });
    const provider = () => plugin('provider', (context) => {
      context.services.register('file', {
        async read(path) { return path; },
        async write() {},
      });
    });
    duplicate.register(provider());
    duplicate.register(plugin('other-provider', (context) => {
      context.services.register('file', {
        async read(path) { return path; },
        async write() {},
      });
    }));
    await expect(duplicate.start()).rejects.toMatchObject({
      cause: expect.any(DuplicateRegistrationError),
    });
  });

  it('returns undefined for unavailable optional services', async () => {
    let result: AppServices['file'] | undefined = { read: async () => '', write: async () => {} };
    const app = new CorvixApplication<Record<never, never>, Record<never, never>, AppServices>({
      apiVersion: '0.1.0',
    });
    app.register(plugin('consumer', (context) => {
      result = context.services.tryGet('file');
    }, undefined, { missing: '^1.0.0' }));
    await app.start();
    expect(result).toBeUndefined();
    await app.stop();
  });
});
