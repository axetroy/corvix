import { satisfies, valid, validRange } from 'semver';
import {
  ApplicationStartError,
  PluginActivationError,
  PluginDeactivationError,
  PluginDependencyError,
  PluginRegistrationError,
} from '../errors.js';
import { DisposableCollection } from '../lifecycle/disposable.js';
import { noopLogger } from '../logging/logger.js';
import type { EventBus } from '../events/event-bus.js';
import type { HookRegistry } from '../hooks/hook-registry.js';
import type { ServiceRegistry } from '../services/service-registry.js';
import type { Logger } from '../logging/logger.js';
import type {
  HostRuntime,
  PluginContext,
  PluginDefinition,
  PluginManifest,
  PluginState,
} from './types.js';

interface RegisteredPlugin<
  TEvents,
  THooks,
  TServices,
  THostCapabilities extends object,
  TConfiguration,
> {
  readonly definition: PluginDefinition<
    TEvents,
    THooks,
    TServices,
    THostCapabilities,
    TConfiguration
  >;
  readonly manifest: PluginManifest;
  state: PluginState;
  context: PluginContext<
    TEvents,
    THooks,
    TServices,
    THostCapabilities,
    TConfiguration
  > | undefined;
}

interface PluginManagerOptions<
  TEvents,
  THooks,
  TServices,
  THostCapabilities extends object,
  TConfiguration,
> {
  readonly apiVersion: string;
  readonly logger?: Logger;
  readonly hooks: HookRegistry<THooks>;
  readonly events: EventBus<TEvents>;
  readonly services: ServiceRegistry<TServices>;
  readonly host: HostRuntime<THostCapabilities, TConfiguration>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateId(id: unknown, owner: string): asserts id is string {
  if (
    typeof id !== 'string'
    || !/^[a-z0-9][a-z0-9._-]*$/i.test(id)
  ) {
    throw new PluginRegistrationError(
      `${owner} must be a non-empty plugin ID containing only letters, numbers, ".", "_" or "-"`,
    );
  }
}

function copyDependencyMap(
  value: unknown,
  ownerId: string,
  kind: string,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new PluginRegistrationError(
      `Plugin "${ownerId}" ${kind} must be an object`,
    );
  }

  const dependencies = Object.create(null) as Record<string, string>;

  for (const [id, range] of Object.entries(value)) {
    validateId(id, `Dependency ID in plugin "${ownerId}"`);
    if (id === ownerId) {
      throw new PluginRegistrationError(
        `Plugin "${ownerId}" cannot depend on itself`,
      );
    }
    if (typeof range !== 'string' || range.trim() === '' || validRange(range) === null) {
      throw new PluginRegistrationError(
        `Plugin "${ownerId}" has an invalid ${kind} range for "${id}"`,
      );
    }
    dependencies[id] = range;
  }

  return Object.freeze(dependencies);
}

function copyManifest(value: unknown): PluginManifest {
  if (!isRecord(value)) {
    throw new PluginRegistrationError('Plugin manifest must be an object');
  }

  const id = value.id;
  validateId(id, 'Plugin manifest ID');

  if (typeof value.version !== 'string' || valid(value.version) === null) {
    throw new PluginRegistrationError(
      `Plugin "${id}" must declare a valid SemVer version`,
    );
  }
  if (
    typeof value.apiVersion !== 'string'
    || value.apiVersion.trim() === ''
    || validRange(value.apiVersion) === null
  ) {
    throw new PluginRegistrationError(
      `Plugin "${id}" must declare a valid API version range`,
    );
  }

  const dependencies = copyDependencyMap(value.dependencies, id, 'dependencies');
  const optionalDependencies = copyDependencyMap(
    value.optionalDependencies,
    id,
    'optionalDependencies',
  );

  for (const dependencyId of Object.keys(dependencies ?? {})) {
    if (optionalDependencies && dependencyId in optionalDependencies) {
      throw new PluginRegistrationError(
        `Plugin "${id}" cannot declare "${dependencyId}" as both required and optional`,
      );
    }
  }

  let capabilities: readonly string[] | undefined;
  if (value.capabilities !== undefined) {
    if (
      !Array.isArray(value.capabilities)
      || value.capabilities.some(
        (capability) => typeof capability !== 'string' || capability.trim() === '',
      )
    ) {
      throw new PluginRegistrationError(
        `Plugin "${id}" capabilities must be non-empty strings`,
      );
    }
    capabilities = Object.freeze([...value.capabilities]);
  }

  return Object.freeze({
    id,
    version: value.version,
    apiVersion: value.apiVersion,
    ...(dependencies === undefined ? {} : { dependencies }),
    ...(optionalDependencies === undefined ? {} : { optionalDependencies }),
    ...(capabilities === undefined ? {} : { capabilities }),
  });
}

function getAggregateErrors(error: unknown): readonly unknown[] {
  if (error instanceof AggregateError) {
    return error.errors;
  }
  return [error];
}

export class PluginManager<
  TEvents = Record<never, never>,
  THooks = Record<never, never>,
  TServices = Record<never, never>,
  THostCapabilities extends object = Record<never, never>,
  TConfiguration = Record<never, never>,
> {
  readonly #apiVersion: string;
  readonly #logger: Logger;
  readonly #hooks: HookRegistry<THooks>;
  readonly #events: EventBus<TEvents>;
  readonly #services: ServiceRegistry<TServices>;
  readonly #plugins = new Map<
    string,
    RegisteredPlugin<
      TEvents,
      THooks,
      TServices,
      THostCapabilities,
      TConfiguration
    >
  >();
  readonly #host: HostRuntime<THostCapabilities, TConfiguration>;
  readonly #activationOrder: string[] = [];

  constructor(
    options: PluginManagerOptions<
      TEvents,
      THooks,
      TServices,
      THostCapabilities,
      TConfiguration
    >,
  ) {
    if (typeof options.apiVersion !== 'string' || valid(options.apiVersion) === null) {
      throw new PluginRegistrationError(
        'Application API version must be a valid SemVer version',
      );
    }

    this.#apiVersion = options.apiVersion;
    this.#logger = options.logger ?? noopLogger;
    this.#hooks = options.hooks;
    this.#events = options.events;
    this.#services = options.services;
    this.#host = options.host;
  }

  get hasActivePlugins(): boolean {
    return [...this.#plugins.values()].some((plugin) => plugin.state === 'active');
  }

  register(
    definition: PluginDefinition<
      TEvents,
      THooks,
      TServices,
      THostCapabilities,
      TConfiguration
    >,
  ): void {
    if (this.hasActivePlugins) {
      throw new PluginRegistrationError(
        'Plugins cannot be registered while another plugin is active',
      );
    }
    if (!isRecord(definition)) {
      throw new PluginRegistrationError('Plugin definition must be an object');
    }
    if (typeof definition.setup !== 'function') {
      throw new PluginRegistrationError('Plugin definition must provide setup()');
    }

    const manifest = copyManifest(definition.manifest);
    if (this.#plugins.has(manifest.id)) {
      throw new PluginRegistrationError(
        `Plugin "${manifest.id}" is already registered`,
      );
    }
    if (
      definition.deactivate !== undefined
      && typeof definition.deactivate !== 'function'
    ) {
      throw new PluginRegistrationError(
        `Plugin "${manifest.id}" deactivate must be a function`,
      );
    }

    this.#plugins.set(manifest.id, {
      definition,
      manifest,
      state: 'registered',
      context: undefined,
    });
  }

  getState(pluginId: string): PluginState | undefined {
    return this.#plugins.get(pluginId)?.state;
  }

  getPluginVersion(pluginId: string): string | undefined {
    return this.#plugins.get(pluginId)?.manifest.version;
  }

  async start(): Promise<void> {
    await this.#activateRoots([...this.#plugins.keys()], true);
  }

  async retry(pluginId: string): Promise<void> {
    const plugin = this.#plugins.get(pluginId);
    if (!plugin) {
      throw new PluginRegistrationError(`Plugin "${pluginId}" is not registered`);
    }
    if (plugin.state !== 'failed') {
      throw new PluginRegistrationError(
        `Plugin "${pluginId}" is not failed and cannot be retried`,
      );
    }

    await this.#activateRoots([pluginId]);
  }

  async stop(): Promise<void> {
    const errors: unknown[] = [];
    const activeIds = [
      ...this.#activationOrder,
      ...[...this.#plugins.keys()].filter(
        (pluginId) => !this.#activationOrder.includes(pluginId),
      ),
    ];
    for (const pluginId of activeIds.reverse()) {
      const plugin = this.#plugins.get(pluginId);
      if (!plugin || plugin.state !== 'active') {
        continue;
      }

      try {
        await this.#deactivate(plugin);
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, 'One or more plugins failed to deactivate');
    }
  }

  async #activateRoots(
    rootIds: readonly string[],
    rollbackExistingOnFailure = false,
  ): Promise<void> {
    let order: string[];
    try {
      order = this.#resolveOrder(rootIds);
    } catch (error) {
      if (error instanceof PluginDependencyError) {
        const failedPlugin = this.#plugins.get(error.pluginId);
        if (failedPlugin) {
          failedPlugin.state = 'failed';
        }
      }
      if (rollbackExistingOnFailure) {
        const rollbackErrors = await this.#rollbackActivePlugins();
        if (rollbackErrors.length > 0) {
          throw new ApplicationStartError(error, rollbackErrors);
        }
      }
      throw error;
    }

    const activated: RegisteredPlugin<
      TEvents,
      THooks,
      TServices,
      THostCapabilities,
      TConfiguration
    >[] = [];
    try {
      for (const pluginId of order) {
        const plugin = this.#plugins.get(pluginId);
        if (!plugin || plugin.state === 'active') {
          continue;
        }

        plugin.state = 'resolving';
        await this.#activate(plugin);
        activated.push(plugin);
        if (!this.#activationOrder.includes(pluginId)) {
          this.#activationOrder.push(pluginId);
        }
      }
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      const rollback = rollbackExistingOnFailure
        ? order.flatMap((pluginId) => {
          const plugin = this.#plugins.get(pluginId);
          return plugin?.state === 'active' ? [plugin] : [];
        })
        : activated;
      for (const plugin of [...rollback].reverse()) {
        try {
          await this.#deactivate(plugin);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }

      if (error instanceof PluginActivationError && rollbackErrors.length > 0) {
        throw new PluginActivationError(error.pluginId, error.cause, [
          ...error.cleanupErrors,
          ...rollbackErrors,
        ]);
      }
      throw error;
    }
  }

  #resolveOrder(rootIds: readonly string[]): string[] {
    const ordered: string[] = [];
    const visited = new Set<string>();
    const visiting: string[] = [];

    const visit = (pluginId: string): void => {
      if (visited.has(pluginId)) {
        return;
      }

      const cycleIndex = visiting.indexOf(pluginId);
      if (cycleIndex !== -1) {
        const cycle = [...visiting.slice(cycleIndex), pluginId].join(' -> ');
        throw new PluginDependencyError(
          pluginId,
          `Plugin dependency cycle detected: ${cycle}`,
        );
      }

      const plugin = this.#plugins.get(pluginId);
      if (!plugin) {
        throw new PluginDependencyError(
          visiting.at(-1) ?? pluginId,
          `Required plugin "${pluginId}" is not registered`,
        );
      }
      if (!satisfies(this.#apiVersion, plugin.manifest.apiVersion)) {
        throw new PluginDependencyError(
          pluginId,
          `Plugin "${pluginId}" requires Corvix API "${plugin.manifest.apiVersion}", but "${this.#apiVersion}" is active`,
        );
      }

      visiting.push(pluginId);
      for (const [dependencyId, range] of Object.entries(
        plugin.manifest.dependencies ?? {},
      )) {
        const dependency = this.#plugins.get(dependencyId);
        if (!dependency) {
          throw new PluginDependencyError(
            pluginId,
            `Plugin "${pluginId}" requires missing plugin "${dependencyId}"`,
          );
        }
        if (!satisfies(dependency.manifest.version, range)) {
          throw new PluginDependencyError(
            pluginId,
            `Plugin "${pluginId}" requires "${dependencyId}" in range "${range}", but "${dependency.manifest.version}" is registered`,
          );
        }
        visit(dependencyId);
      }
      for (const [dependencyId, range] of Object.entries(
        plugin.manifest.optionalDependencies ?? {},
      )) {
        const dependency = this.#plugins.get(dependencyId);
        if (dependency && satisfies(dependency.manifest.version, range)) {
          visit(dependencyId);
        }
      }
      visiting.pop();
      visited.add(pluginId);
      ordered.push(pluginId);
    };

    for (const pluginId of rootIds) {
      visit(pluginId);
    }
    return ordered;
  }

  async #activate(
    plugin: RegisteredPlugin<
      TEvents,
      THooks,
      TServices,
      THostCapabilities,
      TConfiguration
    >,
  ): Promise<void> {
    const disposables = new DisposableCollection();
    const context: PluginContext<
      TEvents,
      THooks,
      TServices,
      THostCapabilities,
      TConfiguration
    > = Object.freeze({
      pluginId: plugin.manifest.id,
      logger: this.#logger,
      disposables,
      hooks: this.#hooks.createAPI(plugin.manifest.id, disposables),
      events: this.#events.createAPI(plugin.manifest.id, disposables),
      services: this.#services.createAPI(
        plugin.manifest.id,
        plugin.manifest,
        disposables,
      ),
      host: this.#host,
    });
    plugin.state = 'activating';
    plugin.context = context;

    try {
      await plugin.definition.setup(context);
      plugin.state = 'active';
    } catch (cause) {
      this.#logError('Plugin activation failed', {
        pluginId: plugin.manifest.id,
        phase: 'activation',
        error: cause,
      });
      let cleanupErrors: readonly unknown[] = [];
      try {
        await disposables.dispose();
      } catch (error) {
        cleanupErrors = getAggregateErrors(error);
        this.#logError('Plugin activation cleanup failed', {
          pluginId: plugin.manifest.id,
          phase: 'activation-cleanup',
          errors: cleanupErrors,
        });
      }
      plugin.context = undefined;
      plugin.state = 'failed';
      throw new PluginActivationError(plugin.manifest.id, cause, cleanupErrors);
    }
  }

  async #deactivate(
    plugin: RegisteredPlugin<
      TEvents,
      THooks,
      TServices,
      THostCapabilities,
      TConfiguration
    >,
  ): Promise<void> {
    plugin.state = 'deactivating';
    const errors: unknown[] = [];
    const context = plugin.context;

    if (context && plugin.definition.deactivate) {
      try {
        await plugin.definition.deactivate(context);
      } catch (error) {
        errors.push(error);
      }
    }

    if (context) {
      try {
        await context.disposables.dispose();
      } catch (error) {
        errors.push(...getAggregateErrors(error));
      }
    }

    plugin.context = undefined;
    plugin.state = 'inactive';
    const activationIndex = this.#activationOrder.lastIndexOf(plugin.manifest.id);
    if (activationIndex !== -1) {
      this.#activationOrder.splice(activationIndex, 1);
    }
    if (errors.length > 0) {
      this.#logError('Plugin deactivation failed', {
        pluginId: plugin.manifest.id,
        phase: 'deactivation',
        errors,
      });
      throw new PluginDeactivationError(plugin.manifest.id, errors);
    }
  }

  async #rollbackActivePlugins(): Promise<unknown[]> {
    const errors: unknown[] = [];
    for (const pluginId of [...this.#activationOrder].reverse()) {
      const plugin = this.#plugins.get(pluginId);
      if (!plugin || plugin.state !== 'active') {
        continue;
      }
      try {
        await this.#deactivate(plugin);
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }

  #logError(message: string, context: unknown): void {
    try {
      this.#logger.error(message, context);
    } catch {
      return;
    }
  }
}
