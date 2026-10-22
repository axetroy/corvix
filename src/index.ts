export { CorvixApplication } from './application/application.js';
export type { ApplicationState } from './application/application.js';
export {
  CorvixError,
  PluginActivationError,
  PluginDeactivationError,
  PluginDependencyError,
  PluginRegistrationError,
} from './errors.js';
export {
  DisposableCollection,
} from './lifecycle/disposable.js';
export type {
  Disposable,
  DisposableResource,
  DisposeCallback,
} from './lifecycle/disposable.js';
export type { Logger } from './logging/logger.js';
export type {
  CorvixApplicationOptions,
  PluginContext,
  PluginDefinition,
  PluginManifest,
  PluginState,
} from './plugin/types.js';
