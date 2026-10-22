import { CorvixApplication } from '../src/index.js';

interface HostEvents {
  'message:received': { message: string };
}

interface HostCapabilities {
  log(message: string): void;
}

interface RuntimeConfiguration {
  serviceName: string;
}

const app = new CorvixApplication<
  HostEvents,
  Record<never, never>,
  Record<never, never>,
  HostCapabilities,
  RuntimeConfiguration
>({
  apiVersion: '0.1.0',
  host: {
    capabilities: {
      log: (message) => console.log(message),
    },
    configuration: { serviceName: 'minimal-host' },
    configurationSchema: {
      parse(input) {
        if (
          typeof input !== 'object'
          || input === null
          || !('serviceName' in input)
          || typeof input.serviceName !== 'string'
        ) {
          throw new TypeError('serviceName must be a string');
        }
        return { serviceName: input.serviceName };
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

app.register({
  manifest: {
    id: 'example.host-message',
    version: '1.0.0',
    apiVersion: '^0.1.0',
  },
  setup(context) {
    context.events.on('message:received', ({ message }) => {
      context.host.capabilities.log(
        `${context.host.configuration.serviceName}: ${message}`,
      );
    });
  },
});

await app.start();
try {
  app.events.emitExternal('message:received', { message: 'hello' });
} finally {
  await app.stop();
}
