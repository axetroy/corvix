import { describe, expect, it } from 'vitest';
import {
  CorvixApplication,
  EventDispatchError,
} from '../../src/index.js';
import type { PluginDefinition } from '../../src/index.js';

interface AppEvents {
  'file:saved': { path: string; hash: string };
}

function plugin(
  id: string,
  setup: PluginDefinition<AppEvents, Record<never, never>, Record<never, never>>['setup'],
): PluginDefinition<AppEvents, Record<never, never>, Record<never, never>> {
  return {
    manifest: { id, version: '1.0.0', apiVersion: '^0.1.0' },
    setup,
  };
}

describe('typed Event API', () => {
  it('dispatches synchronously in registration order and supports independent disposers', async () => {
    const calls: string[] = [];
    let emit!: (path: string) => void;
    const app = new CorvixApplication<AppEvents, Record<never, never>, Record<never, never>>({
      apiVersion: '0.1.0',
    });
    app.register(plugin('observer', (context) => {
      emit = (path) => context.events.emit('file:saved', { path, hash: 'abc' });
      const listener = ({ path }: { path: string }) => { calls.push(`listener:${path}`); };
      const disposeFirst = context.events.on('file:saved', listener);
      context.events.on('file:saved', listener);
      disposeFirst();
      disposeFirst();
    }));
    app.register(plugin('second', (context) => {
      context.events.on('file:saved', ({ path }) => { calls.push(`second:${path}`); });
    }));

    await app.start();
    emit('/tmp/a');
    expect(calls).toEqual(['listener:/tmp/a', 'second:/tmp/a']);
    await app.stop();
    expect(() => emit('/tmp/b')).toThrow();
  });

  it('continues dispatch after failures and reports each owning plugin', async () => {
    const calls: string[] = [];
    let emit!: () => void;
    const app = new CorvixApplication<AppEvents, Record<never, never>, Record<never, never>>({
      apiVersion: '0.1.0',
    });
    app.register(plugin('sender', (context) => {
      emit = () => context.events.emit('file:saved', {
        path: '/tmp/a',
        hash: 'abc',
      });
    }));
    app.register(plugin('broken', (context) => {
      context.events.on('file:saved', () => {
        calls.push('broken');
        throw new Error('listener failed');
      });
    }));
    app.register(plugin('healthy', (context) => {
      context.events.on('file:saved', () => { calls.push('healthy'); });
    }));

    await app.start();
    let failure: unknown;
    try {
      emit();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(EventDispatchError);
    expect(failure).toMatchObject({
      eventName: 'file:saved',
      failures: [{
        pluginId: 'broken',
        error: expect.objectContaining({ message: 'listener failed' }),
      }],
    });
    expect(calls).toEqual(['broken', 'healthy']);
    await app.stop();
  });

  it('rejects async listeners at runtime but continues the dispatch', async () => {
    const calls: string[] = [];
    let emit!: () => void;
    const app = new CorvixApplication<AppEvents, Record<never, never>, Record<never, never>>({
      apiVersion: '0.1.0',
    });
    app.register(plugin('sender', (context) => {
      emit = () => context.events.emit('file:saved', {
        path: '/tmp/a',
        hash: 'abc',
      });
    }));
    app.register(plugin('async-listener', (context) => {
      context.events.on(
        'file:saved',
        (async () => {}) as unknown as (payload: AppEvents['file:saved']) => void,
      );
    }));
    app.register(plugin('healthy', (context) => {
      context.events.on('file:saved', () => { calls.push('healthy'); });
    }));

    await app.start();
    expect(emit).toThrow(EventDispatchError);
    expect(calls).toEqual(['healthy']);
    await app.stop();
  });
});
