import { CorvixApplication } from '../src/index.js';

const app = new CorvixApplication({ apiVersion: '0.1.0' });
app.register({
  manifest: {
    id: 'typed.plugin',
    version: '1.0.0',
    apiVersion: '^0.1.0',
  },
  setup(context) {
    const pluginId: string = context.pluginId;
    context.disposables.add(() => { void pluginId; });
  },
});

// @ts-expect-error API version must be a string
new CorvixApplication({ apiVersion: 1 });

// @ts-expect-error Plugin setup is required
app.register({ manifest: { id: 'invalid', version: '1.0.0', apiVersion: '^0.1.0' } });
