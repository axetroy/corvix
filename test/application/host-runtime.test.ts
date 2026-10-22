import { describe, expect, it } from 'vitest';
import {
  ContractValidationError,
  CorvixApplication,
} from '../../src/index.js';
import type { HostRuntime } from '../../src/index.js';

interface HostEvents {
  'message:received': { message: string };
}

interface HostCapabilities {
  now(): number;
}

interface RuntimeConfiguration {
  region: string;
}

describe('host runtime contracts', () => {
  it('injects immutable host capabilities and validated configuration', async () => {
    let exposedHost: HostRuntime<HostCapabilities, RuntimeConfiguration> | undefined;
    const app = new CorvixApplication<
      HostEvents,
      Record<never, never>,
      Record<never, never>,
      HostCapabilities,
      RuntimeConfiguration
    >({
      apiVersion: '0.1.0',
      host: {
        capabilities: { now: () => 123 },
        configuration: { region: 'test' },
        configurationSchema: {
          parse(input) {
            if (
              typeof input !== 'object'
              || input === null
              || !('region' in input)
              || typeof input.region !== 'string'
            ) {
              throw new TypeError('region must be a string');
            }
            return { region: input.region };
          },
        },
        eventSchemas: {
          'message:received': {
            parse(input) {
              if (
                typeof input !== 'object'
                || input === null
                || !('message' in input)
                || typeof input.message !== 'string'
              ) {
                throw new TypeError('message must be a string');
              }
              return { message: input.message };
            },
          },
        },
      },
    });
    const messages: string[] = [];
    app.register({
      manifest: { id: 'host.observer', version: '1.0.0', apiVersion: '^0.1.0' },
      setup(context) {
        exposedHost = context.host;
        context.events.on('message:received', ({ message }) => {
          messages.push(message);
        });
      },
    });

    await app.start();
    expect(exposedHost).toBeDefined();
    expect(exposedHost?.capabilities.now()).toBe(123);
    expect(exposedHost?.configuration.region).toBe('test');
    expect(Object.isFrozen(exposedHost?.capabilities)).toBe(true);
    expect(Object.isFrozen(exposedHost?.configuration)).toBe(true);
    expect(() => app.events.emitExternal('message:received', { message: 1 }))
      .toThrow(ContractValidationError);
    app.events.emitExternal('message:received', { message: 'hello' });
    expect(messages).toEqual(['hello']);
    await app.stop();
  });

  it('rejects invalid host configuration before plugins can start', () => {
    expect(() => new CorvixApplication<
      Record<never, never>,
      Record<never, never>,
      Record<never, never>,
      Record<never, never>,
      RuntimeConfiguration
    >({
      apiVersion: '0.1.0',
      host: {
        configuration: { region: 1 } as unknown as RuntimeConfiguration,
        configurationSchema: {
          parse(input) {
            if (
              typeof input !== 'object'
              || input === null
              || !('region' in input)
              || typeof input.region !== 'string'
            ) {
              throw new TypeError('region must be a string');
            }
            return { region: input.region };
          },
        },
      },
    })).toThrow(ContractValidationError);
  });

  it('requires a schema before accepting external event input', async () => {
    const app = new CorvixApplication<HostEvents>({
      apiVersion: '0.1.0',
    });
    await app.start();
    expect(() =>
      app.events.emitExternal('message:received', { message: 'hello' })
    ).toThrow(ContractValidationError);
    await app.stop();
  });
});
