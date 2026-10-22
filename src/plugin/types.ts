import type { DisposableCollection } from '../lifecycle/disposable.js';
import type { Logger } from '../logging/logger.js';
import type { EventAPI, EventMapShape } from '../events/types.js';
import type {
  HookAPI,
  HookMapShape,
  HookRuntimeConfiguration,
} from '../hooks/types.js';
import type { ServiceAPI, ServiceMapShape } from '../services/types.js';

export interface RuntimeSchema<T> {
  parse(input: unknown): T;
}

export interface HostRuntime<
  TCapabilities extends object,
  TConfiguration,
> {
  readonly capabilities: Readonly<TCapabilities>;
  readonly configuration: Readonly<TConfiguration>;
}

export type ExternalEventSchemas<TEvents> = Partial<{
  readonly [K in keyof TEvents]: RuntimeSchema<TEvents[K]>;
}>;

export interface PluginManifest {
  readonly id: string;
  readonly version: string;
  readonly apiVersion: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly capabilities?: readonly string[];
}

export interface PluginContext<
  TEvents = Record<never, never>,
  THooks = Record<never, never>,
  TServices = Record<never, never>,
  THostCapabilities extends object = Record<never, never>,
  TConfiguration = Record<never, never>,
> {
  readonly pluginId: string;
  readonly logger: Logger;
  readonly disposables: DisposableCollection;
  readonly hooks: HookAPI<THooks>;
  readonly events: EventAPI<TEvents>;
  readonly services: ServiceAPI<TServices>;
  readonly host: HostRuntime<THostCapabilities, TConfiguration>;
}

export interface PluginDefinition<
  TEvents = Record<never, never>,
  THooks = Record<never, never>,
  TServices = Record<never, never>,
  THostCapabilities extends object = Record<never, never>,
  TConfiguration = Record<never, never>,
> {
  readonly manifest: PluginManifest;
  setup(
    context: PluginContext<
      TEvents,
      THooks,
      TServices,
      THostCapabilities,
      TConfiguration
    >,
  ): void | Promise<void>;
  deactivate?(
    context: PluginContext<
      TEvents,
      THooks,
      TServices,
      THostCapabilities,
      TConfiguration
    >,
  ): void | Promise<void>;
}

export type PluginState =
  | 'registered'
  | 'resolving'
  | 'activating'
  | 'active'
  | 'deactivating'
  | 'inactive'
  | 'failed';

export type CorvixApplicationOptions<
  TEvents = Record<never, never>,
  THooks = Record<never, never>,
  THostCapabilities extends object = Record<never, never>,
  TConfiguration = Record<never, never>,
> = {
  readonly apiVersion: string;
  readonly logger?: Logger;
  readonly host?: {
    readonly capabilities?: THostCapabilities;
    readonly configuration?: TConfiguration;
    readonly configurationSchema?: RuntimeSchema<TConfiguration>;
    readonly eventSchemas?: ExternalEventSchemas<TEvents>;
  };
} & (keyof THooks extends never
  ? { readonly hooks?: HookRuntimeConfiguration<THooks> }
  : { readonly hooks: HookRuntimeConfiguration<THooks> });

export type {
  EventMapShape,
  HookMapShape,
  ServiceMapShape,
};
