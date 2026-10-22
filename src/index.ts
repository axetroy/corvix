export { CorvixApplication } from './application/application.js';
export type { ApplicationState } from './application/application.js';
export {
  DuplicateRegistrationError,
  EventDispatchError,
  EventRegistrationError,
  HookExecutionError,
  HookRegistrationError,
  CorvixError,
  PluginActivationError,
  PluginDeactivationError,
  PluginDependencyError,
  PluginRegistrationError,
  ServiceNotFoundError,
  ServiceRegistrationError,
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
  BailResult,
  HookAPI,
  HookArguments,
  HookContract,
  HookHandler,
  HookMapShape,
  HookMode,
  HookRegistrationOptions,
  HookRunner,
  HookResult,
  HookRuntimeConfiguration,
  HookRunArguments,
  HookRunReturn,
  HookStrategy,
} from './hooks/types.js';
export type { EventAPI, EventEmitter, EventMapShape } from './events/types.js';
export type { ServiceAPI, ServiceMapShape } from './services/types.js';
export type {
  CorvixApplicationOptions,
  PluginContext,
  PluginDefinition,
  PluginManifest,
  PluginState,
} from './plugin/types.js';
