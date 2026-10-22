import type { DisposableCollection } from '../lifecycle/disposable.js';
import type { Logger } from '../logging/logger.js';

export interface PluginManifest {
  readonly id: string;
  readonly version: string;
  readonly apiVersion: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly capabilities?: readonly string[];
}

export interface PluginContext {
  readonly pluginId: string;
  readonly logger: Logger;
  readonly disposables: DisposableCollection;
}

export interface PluginDefinition {
  readonly manifest: PluginManifest;
  setup(context: PluginContext): void | Promise<void>;
  deactivate?(context: PluginContext): void | Promise<void>;
}

export type PluginState =
  | 'registered'
  | 'resolving'
  | 'activating'
  | 'active'
  | 'deactivating'
  | 'inactive'
  | 'failed';

export interface CorvixApplicationOptions {
  readonly apiVersion: string;
  readonly logger?: Logger;
}
